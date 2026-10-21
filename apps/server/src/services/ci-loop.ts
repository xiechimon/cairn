// #1150 CI 磨绿环（server 轮询器）：「任务发完 PR 并把 CI 磨到绿」的服务器半。
// webhook 不可行（server 在 tailnet 内，GitHub 打不进来）——轮询是唯一通道；
// 挂 scheduler 家族（services/scheduler.ts start/stop 生命周期），60s 自循环
// ——不进 tick()：tick 是同步契约（shared Scheduler.tick: void），网络读
// 不许把异步塞进同步面（GC 的 sweep 是纯 fs 所以能 piggyback，本模块不能）。
//
// 状态机（票面钉死三态）：
//   pending（有 check 在跑/排队）→ 不动——「checks pending 被误判红」是票面
//     列名的失败方式，判据钉「全部 completed 才判红绿」；
//   red（有 failure/timed_out）→ 同 build 追加修复步（enqueueStep 续轮，同
//     conv 同分支 = 原 PR 就地更新；prompt 带失败 check 名与日志摘要 + 轮号）；
//   green（全 success；仓无 CI 超 grace 也算）→ phase 推进 review 闸（人工接管）。
// 死循环闸：同一 build 连续修复 N 轮（默认 3）仍红 → 停手，build.errorMessage
//   落因 + todo → failed（转人工；既有 failed→review 恢复闸 #702 照常可用）。
//
// 纪律（票面）：
// - 只读 GitHub（checks 读取），不写——本模块零 api.github.com 写面；
// - 扫描面批量（一条 DB 查询取全候选）+ 条件请求（磨绿候选每轮恰好 1 个
//   If-None-Match 条件 GET，304 复用缓存判据），禁止逐 PR 全量拉——GitHub
//   无跨 PR 批量端点，条件 GET 是最小合规形；429/404/网络 = fail-open 不动，
//   下轮重试（读不到 ≠ 红）；
// - build 已被人手动推进/关闭时不得回写：候选是扫描快照，动作前重读当前
//   phase（两次：网络读之前、写面之前——网络窗是人工动作最可能落进的缝）；
// - 有步在飞（hasActiveStep：已领取的任意步，排队中或等额度的非审核类步）
//   不叠派：读到的 checks 是推送前旧 head 的，等它跑完重评（幂等：同轮重复
//   sweep 不追加第二条）。没人领（排队中或等额度）的 verify / review 步不挡
//   磨绿与对账。
//
// 磨绿入口（completeStep 的 build 分支，builds.ts）：PR 交付（prNumber 在）
// 的执行步成 → 停在 building（本模块推进 review）；无 PR → 既有直进 review
// 不变。空 checks 宽限：PR head 上一条 check 都没有 = 「仓没配 CI」与「CI
// 还没注册 check（竞态）」不可分——宽限内按 pending 等，超宽限按绿交人
// （不把无 CI 仓永远锁在 building）。
//
// #1403 第二候选集（review 关口的 PR 对账）：相位 review、build 是 todo 的
// 当前 build（todo.latestBuildId；更旧的被取代 PR 关了或合了都不算数，当前
// build 没 PR 时也不拿旧 PR 替它收尾）、没有在飞的步（merge 步正在合并时不
// 插手）。未连接 GitHub（匿名 60 次/小时按 IP 算）时每候选 5 分钟最多读一次，
// 对账自己每小时至多 20 次、连同磨绿至多 50 次，pulls 读要给它可能跟着的
// compare 留一次额度。每候选
// 一次条件 GET pulls/{n}，合并后分支 head 与最后的 checkpoint 不同时再加一次
// compare（结果按 checkpoint 与 head 缓存，同一对只读一次）：
// - 已合并（不论谁合的）进了默认分支、且合并时的 head 包含最后的 checkpoint
//   → system 行写合并 SHA + done 收尾漏斗（与 merge 步成同一条）；
// - 关闭未合并、隔一轮再读到仍关闭（为重跑 CI 关掉又重开 PR 不算）→ system
//   行 + build.errorMessage + failed；
// - open → 不动；读不到 / 网络窗内相位被人改 → 不动（同磨绿面 ④ 纪律）。
// - 写之前核对 PR 是本 build 的：PR 号是 daemon 按分支名查到的（gh pr list
//   --head 只比分支名），公开仓里别人 fork 的同名分支开的 PR 也会被查到。head
//   仓（owner/repo 不分大小写）是目标仓、head 分支是本 build 的工作分支才写；
//   对不上 → 不收尾不打回，提示一次；响应缺这两个字段 → 按读不到。
// 每个结局每一轮只报告一次（轮界 = 本 build 最近一个 build / plan 步，#931
// 返工复用同一个 build 时从新的一轮算起）：本轮已有完成行（合并步或对账写的）
// 就不再按「已合并」收，已有对账的关闭行就不再按「已关闭」收。人在报告之后把
// 卡拖回 review 是人的决定；报告之前人手拖到已完成或已关闭再拖回，报告照样
// 来一次。不看时钟：CI 一绿就合并（含 GitHub auto-merge）时卡在合并之后才进
// review，照样收尾。收尾时停掉没人领的 verify / review 步。

import { conversationBranch } from '@pacman/shared';
import { and, desc, eq, inArray, isNotNull, like, notInArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, project, step, todo } from '../db/schema.js';
import {
  type FetchLike,
  type GithubCheckRun,
  type GithubPull,
  githubCommitCheckRuns,
  githubCompareStatus,
  githubPull,
  isFullSha,
} from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  type BuildDeps,
  DONE_ROW,
  enqueueStep,
  finishTodoDone,
  hasMessageRow,
  maybeEnqueueVerifyStep,
  roundStart,
  stopUnclaimedGateSteps,
  toBuildRecord,
} from './builds.js';
import { openGithubToken } from './github-connection.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

/** 轮询节奏（票面：60s 扫）。 */
export const CI_POLL_INTERVAL_MS = 60_000;

/** 死循环闸阈值：同一 build 连续修复 N 轮仍红 → 停手转人工。 */
export const CI_FIX_ROUNDS_MAX = 3;

/** 空 checks 宽限（[设计]：够 GitHub Actions 在新 head 上注册 check；仓真没
 * CI 时延迟到此推闸交人）。 */
export const CI_EMPTY_CHECKS_GRACE_MS = 300_000;

/** 未连接 GitHub 时 PR 对账的最短重读间隔（匿名主限流 60 次/小时，#931 /
 * #1217 守卫同用这份额度）。 */
export const CI_ANON_READ_INTERVAL_MS = 300_000;

/** compare 答 404（提交不在 GitHub 上）或读不到之后，同一对提交的最短重读间隔。 */
export const CI_MISSING_COMPARE_RECHECK_MS = 600_000;

/** 未连接 GitHub 时对账自己每小时最多发的匿名请求（pulls 与 compare 合计）。 */
export const CI_ANON_READS_PER_HOUR = 20;

/** 对账与磨绿合计每小时最多发的匿名请求：GitHub 的匿名主限流 60 次/小时按 IP
 * 算，留 10 次给 #931 / #1217 守卫。磨绿只记数、不受它拦，对账在总数满了时
 * 不读。 */
export const CI_ANON_IP_READS_PER_HOUR = 50;

/** PR 读到关闭未合并之后，隔这么久再读到仍关闭才打成 failed：为重跑 CI 关掉又
 * 重开 PR 很常见，一次 sweep 落在中间不算（略短于一轮 sweep，下一轮即确认）。 */
export const CI_CLOSED_CONFIRM_MS = 50_000;

/** 修复步 prompt 头行标记：修复轮计数判据（marker prompt 的 build 步 = 一轮
 * 修复；原执行步/confirm 步无 marker 不计——与 buildRestartPrompt 等模板步
 * 的识别同律）。 */
export const CI_FIX_PROMPT_HEAD = '[ci-fix]';

/** fix prompt 里单条失败摘要的截断（prompt 是会话注入位，不给无界长文本）。 */
const CI_FIX_SUMMARY_MAX = 800;

/** 对账日志口（scheduler 接线传 pino；每 sweep 一行：候选数 × 三态落位）。 */
export interface CiPollLogger {
  info(obj: object, msg: string): void;
}

export interface CiPoller {
  /** 单轮扫描：批量取候选 → 每候选一次条件 GET → 按三态落位。 */
  sweep(now?: number): Promise<void>;
}

/** 失败 check 的最小材料（fix prompt 位）：name + conclusion + 日志摘要
 * （GitHub 在 check-runs 端点给的 output.summary/title，真实日志不在轮询面）。 */
export interface CiCheckFailure {
  name: string;
  conclusion: string;
  summary: string | null;
}

export type CheckVerdict =
  | { state: 'green' }
  | { state: 'pending' }
  /** PR head 零 check run（仓无 CI / CI 未注册竞态——宽限归调用方）。 */
  | { state: 'empty' }
  | { state: 'red'; failures: CiCheckFailure[] };

/** 三态判定（含 empty 第四形）：有 check 未 completed → pending（先于红绿，
 * 「pending 被误判红」的闸）；completed 里 failure/timed_out → red；
 * 其余（success 全绿 / neutral / skipped / cancelled）→ green——neutral 与
 * skipped 是有意的非门禁，cancelled 是新推送顶替或人工取消，都交人不重磨。 */
export function verdictOfCheckRuns(runs: GithubCheckRun[]): CheckVerdict {
  if (runs.length === 0) return { state: 'empty' };
  if (runs.some((r) => r.status !== 'completed')) return { state: 'pending' };
  const failures = runs
    .filter((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out')
    .map((r) => ({
      name: r.name,
      conclusion: r.conclusion ?? '',
      summary: r.outputSummary ?? r.outputTitle,
    }));
  if (failures.length > 0) return { state: 'red', failures };
  return { state: 'green' };
}

/** 修复步指令（step.prompt → claim instruction 位，daemon 以「任务文本 +
 * 指令」组合串进会话，#720 同律）。头行带 marker（计数判据），正文带失败
 * check 名与日志摘要 + 轮号 + 推送纪律（同一分支，不合并）。 */
export function buildCiFixPrompt(args: {
  prNumber: number;
  prUrl: string | null;
  round: number;
  failures: CiCheckFailure[];
}): string {
  const failures = args.failures
    .map((f) => {
      const summary = f.summary !== null ? `：${f.summary.slice(0, CI_FIX_SUMMARY_MAX)}` : '';
      return `- ${f.name}（${f.conclusion}）${summary}`;
    })
    .join('\n');
  return [
    `${CI_FIX_PROMPT_HEAD} CI 修复轮（第 ${args.round} 轮）：PR #${args.prNumber}${args.prUrl ? `（${args.prUrl}）` : ''} 的 CI 检查未通过。`,
    '',
    '失败的检查：',
    failures,
    '',
    '请修复以上检查，并在同一分支上推送（不要新开分支、不要合并 PR）；推送后 CI 会重跑，系统会继续轮询直到检查通过。',
  ].join('\n');
}

/** 已完成的连续修复轮数（死循环闸计数）：marker prompt 的 build 步 = 一轮。
 * 无状态过滤——扫描集已挡在飞步（pending/claimed 跳过），此处全部是终态步。 */
function countCiFixRounds(db: Db, buildId: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'build'),
        like(step.prompt, `${CI_FIX_PROMPT_HEAD}%`),
      ),
    )
    .all().length;
}

function deadLoopMessage(rounds: number): string {
  return `CI 检查连续 ${rounds} 轮自动修复仍未通过（死循环闸：连续 ${CI_FIX_ROUNDS_MAX} 轮）——停止追加修复步，转人工处理。`;
}

/** ETag 缓存行（进程内存——单进程 server；重启失缓存 = 下轮多一次全量读，
 * 无害）。verdict 缓存仅在 304 时复用（200 恒刷新）。 */
interface PrChecksCacheEntry {
  etag: string | null;
  verdict: CheckVerdict | null;
  /** 首见「空 checks」的时刻（宽限锚点；非空 verdict 恒 null）。 */
  emptySince: number | null;
}

interface CiPollTally {
  candidates: number;
  /** pending / 空 checks 宽限内：不动。 */
  pending: number;
  /** 红 → 追加修复步。 */
  appended: number;
  /** 绿（含空超宽限）→ 推 review 闸。 */
  advanced: number;
  /** 死循环闸 → failed 转人工。 */
  failed: number;
  /** 已推进/关闭/在飞步/形态不齐：不动。 */
  skipped: number;
  /** 读不到（限流/404/网络）：fail-open 下轮重试。 */
  unreadable: number;
  /** 单候选意外异常（不杀整轮）。 */
  errors: number;
  /** #1403 review 关口候选数（todo 当前 build 带 PR）。 */
  reviewCandidates: number;
  /** 对账：PR 仍 open，或关闭了还待下一轮确认。 */
  reviewPending: number;
  /** 对账：形态不齐、有步在飞、网络窗里相位变了、匿名额度不够：不动。 */
  reviewSkipped: number;
  /** 对账：读不到（限流/404/网络/响应缺字段）：fail-open 下轮重试。 */
  reviewUnreadable: number;
  /** 对账：PR 的 head 仓或分支不是本 build 的（例如 fork 的同名分支）：不写。 */
  reviewForeign: number;
  /** PR 已在 GitHub 合并 → done。 */
  merged: number;
  /** PR 关闭未合并 → failed。 */
  closedUnmerged: number;
  /** 已合并但分支上有合并没带走的提交，或合进了非默认分支：提示一次，不收尾。 */
  hinted: number;
  /** 本轮已报告过这个结局（人后来把卡拖回了 review）：交给人。 */
  settledBefore: number;
}

/** PR 对账的条件读缓存行（etag + 上轮 PR 状态；304 时复用）。 */
interface PullCacheEntry {
  etag: string | null;
  pull: GithubPull | null;
}

export function createCiPoller(
  deps: BuildDeps,
  run: {
    githubFetch: FetchLike;
    logger?: CiPollLogger;
    anonReadsPerHour?: number;
    anonIpReadsPerHour?: number;
  },
): CiPoller {
  const cache = new Map<string, PrChecksCacheEntry>();
  const pullCache = new Map<string, PullCacheEntry>();
  /** 匿名读的上次时刻（按 PR）。 */
  const anonReadAt = new Map<string, number>();
  /** compare 结果（键 = PR + checkpoint + head；两个固定提交之间的结果不变，
   * 读到即可复用；404 例外：那个提交之后可能被推上去，过 CI_MISSING_COMPARE_
   * RECHECK_MS 再读）。 */
  const compareCache = new Map<
    string,
    Map<string, { status: string; at: number; failures: number }>
  >();
  /** 每个 review 候选上次读 pulls 的时刻（匿名额度轮着用：最久没读的先读）。 */
  const lastReadByBuild = new Map<string, number>();
  /** 首次读到关闭未合并的时刻（按 PR）；读到 open 即清。 */
  const closedSeenAt = new Map<string, number>();
  /** 已确认的「本轮已报告」与「提示已落」（只缓存肯定结果，免得每轮查表）。 */
  const knownRows = new Set<string>();
  /** 本轮 sweep 见到的候选的缓存键（review / 磨绿各一份）；sweep 末尾据此清掉
   * 别的缓存行。 */
  const liveKeys = new Set<string>();
  const grindKeys = new Set<string>();
  /** 上一轮 sweep 还在跑（网络读慢）时下一轮不进来：缓存与匿名额度按单轮设计。 */
  let sweeping = false;
  /** 本轮 sweep 开始的真实时刻：一次读真正发生的时刻 = now + 已过去的时间
   * （慢的一轮里，排在后面的读可能比 sweep 开始晚几十秒）。 */
  let sweepStartedAt = 0;
  /** 最近一小时的匿名请求时刻：对账自己的，与对账加磨绿的（按 IP 的总数）。 */
  const anonOwn: number[] = [];
  const anonAll: number[] = [];

  function anonFree(now: number): number {
    for (const list of [anonOwn, anonAll]) {
      while (list.length > 0 && (list[0] ?? now) <= now - 3_600_000) list.shift();
    }
    return Math.min(
      (run.anonReadsPerHour ?? CI_ANON_READS_PER_HOUR) - anonOwn.length,
      (run.anonIpReadsPerHour ?? CI_ANON_IP_READS_PER_HOUR) - anonAll.length,
    );
  }

  /** 磨绿的匿名读：只记进按 IP 的总数，不受额度拦。 */
  function recordGrindAnonRead(now: number): void {
    anonFree(now);
    anonAll.push(now);
  }

  /** 取一次对账的匿名额度；need = 这次读之后还要留出的次数（pulls 读要给它
   * 可能跟着的 compare 留一次）。 */
  function takeAnonRead(now: number, need = 1): boolean {
    if (anonFree(now) < need) return false;
    anonOwn.push(now);
    anonAll.push(now);
    return true;
  }

  /** 本 build 有在飞的步：已被领取的任意步，以及排队中或等额度的非审核类
   * 步。没人领（排队中或等额度）的 verify / review 步不算（Verifier 的机器
   * 离线或额度耗尽时，卡不能因此永远停在 review）。 */
  function hasActiveStep(buildId: string): boolean {
    return (
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, buildId),
            or(
              eq(step.status, 'claimed'),
              and(
                inArray(step.status, ['pending', 'waiting_quota']),
                notInArray(step.kind, ['verify', 'review']),
              ),
            ),
          ),
        )
        .get() !== undefined
    );
  }

  /** 本轮（since 起）是否已有这一行；肯定结果记进 knownRows，之后不再查表。 */
  function rowKnown(buildId: string, content: string, since: number): boolean {
    const memo = `${buildId}\u0000${since}\u0000${content}`;
    if (knownRows.has(memo)) return true;
    if (!hasMessageRow(deps, buildId, 'system', content, since)) return false;
    knownRows.add(memo);
    return true;
  }

  /** compare 读回来之后（await 之后）还轮得到对账写：卡仍在 review 且是当前
   * build、没有步开始在飞、本轮还没有完成行（合并步刚收过尾）。 */
  function stillOurs(cand: { buildId: string; todoId: string }, since: number): boolean {
    return (
      freshReviewRow(cand.todoId, cand.buildId) !== null &&
      !hasActiveStep(cand.buildId) &&
      !rowKnown(cand.buildId, DONE_ROW, since)
    );
  }

  /** 失败收尾：build.errorMessage 落因 + 发 build 文档 + todo → failed。 */
  function failWithMessage(
    cand: { buildId: string; todoId: string },
    teamId: string,
    text: string,
  ) {
    deps.db.update(build).set({ errorMessage: text }).where(eq(build.id, cand.buildId)).run();
    const row = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    if (row) deps.hub.publishBuildDoc(teamId, toBuildRecord(row));
    setTodoPhase(deps, cand.todoId, 'failed');
  }

  /** 对账写进本 build 会话的 system 行（提示、合并行、关闭行）。 */
  function writeSystemRow(buildId: string, content: string): void {
    insertMessageRow(deps, buildId, {
      id: newRecordId(),
      role: 'system',
      content,
      createdAt: nowMs(),
    });
  }

  /** 同一条提示每轮（since 起）只落一次（按内容去重）。 */
  function hintOnce(buildId: string, content: string, since: number, tally: CiPollTally): void {
    if (rowKnown(buildId, content, since)) return;
    writeSystemRow(buildId, content);
    tally.hinted += 1;
  }

  /** 读当前 phase，不在磨绿集 = 不动（④：已被人工推进/关闭/终态）。 */
  function freshGrindRow(todoId: string) {
    const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
    return row !== undefined && row.phase === 'building' ? row : null;
  }

  /** 读当前 phase 与当前 build：仍在 review 且 build 仍是 todo 的当前 build。 */
  function freshReviewRow(todoId: string, buildId: string) {
    const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
    return row !== undefined && row.phase === 'review' && row.latestBuildId === buildId
      ? row
      : null;
  }

  /** github 形态目标（owner/repo）；非 github 或缺仓名 → null。 */
  function githubTarget(projectId: string) {
    const projRow = deps.db.select().from(project).where(eq(project.id, projectId)).get();
    if (projRow === undefined || projRow.repoKind !== 'github' || projRow.githubRepo === null) {
      return null;
    }
    const slash = projRow.githubRepo.indexOf('/');
    if (slash < 1 || slash === projRow.githubRepo.length - 1) return null;
    return {
      teamId: projRow.teamId,
      fullName: projRow.githubRepo,
      owner: projRow.githubRepo.slice(0, slash),
      repo: projRow.githubRepo.slice(slash + 1),
    };
  }

  /** token 阶梯（#931 同律）：连接 token → 匿名（公开仓可达）；box 缺席/密文
   * 损坏按未连接（轮询是辅助面，不把 500 打进调度循环）。 */
  function tokenFor(teamId: string): string | null {
    if (deps.box === undefined) return null;
    try {
      return openGithubToken({ db: deps.db, box: deps.box }, teamId);
    } catch {
      return null;
    }
  }

  async function reconcileOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    const todoRow = freshReviewRow(cand.todoId, cand.buildId);
    // 只取 PR 号：build 行的 changes 列是整份 diff，每轮每候选不必读它。
    const buildRow = deps.db
      .select({ prNumber: build.prNumber })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = todoRow === null ? null : githubTarget(todoRow.projectId);
    if (
      todoRow === null ||
      buildRow === undefined ||
      buildRow.prNumber === null ||
      target === null
    ) {
      tally.reviewSkipped += 1;
      return;
    }
    const prNumber = buildRow.prNumber;
    const key = `${target.fullName}#${prNumber}`;
    liveKeys.add(key);
    if (hasActiveStep(cand.buildId)) {
      tally.reviewSkipped += 1; // merge 步在飞：合并结果由它收尾
      return;
    }
    const token = tokenFor(target.teamId);
    const entry = pullCache.get(key) ?? null;
    let pull: GithubPull | null;
    let readAt = now;
    if (entry?.pull?.merged === true) {
      // 合并是终态：卡留在 review（提示、人拖回）时不再重读，不耗读额度。缺合并
      // 判据字段的响应不留在缓存里（见下），之后照常节流重读。
      pull = entry.pull;
    } else {
      if (token === null) {
        const last = anonReadAt.get(key);
        if (
          (last !== undefined && now - last < CI_ANON_READ_INTERVAL_MS) ||
          !takeAnonRead(now, 2)
        ) {
          tally.reviewSkipped += 1;
          return;
        }
        anonReadAt.set(key, now);
      }
      lastReadByBuild.set(cand.buildId, now);
      const page = await githubPull(run.githubFetch, token, target.owner, target.repo, prNumber, {
        etag: entry?.etag ?? null,
      });
      readAt = now + (nowMs() - sweepStartedAt);
      if (page === null) {
        tally.reviewUnreadable += 1;
        return;
      }
      pull = page.notModified ? (entry?.pull ?? null) : page.pull;
      pullCache.set(key, { etag: page.etag, pull });
    }
    if (pull === null || pull.state === 'open') {
      closedSeenAt.delete(key);
      tally.reviewPending += 1;
      return;
    }
    // 写面前再读（④）：网络窗内相位或当前 build 变了、或有步开始在飞 → 弃写。
    if (freshReviewRow(cand.todoId, cand.buildId) === null || hasActiveStep(cand.buildId)) {
      tally.reviewSkipped += 1;
      return;
    }
    const closedText = `PR #${prNumber} 已在 GitHub 关闭且未合并，多半是有人决定不要这次改动。是否重做由人决定；重启任务会新开分支与 PR。`;
    const since = roundStart(deps, cand.buildId);
    // PR 是本 build 的才写（见文件头）：缺字段的响应不当终态缓存（同下文合并判据）。
    if (pull.headRepo === null || pull.headRef === null) {
      pullCache.delete(key);
      tally.reviewUnreadable += 1;
      return;
    }
    const branch = conversationBranch(cand.buildId);
    if (pull.headRepo.toLowerCase() !== target.fullName.toLowerCase() || pull.headRef !== branch) {
      hintOnce(
        cand.buildId,
        `PR #${prNumber} 的 head 不是本任务在 ${target.fullName} 的工作分支「${branch}」，可能是别人 fork 里同名分支开的 PR。对账不据它收尾或打回；任务留在审核关口，由人核对这张 PR。`,
        since,
        tally,
      );
      tally.reviewForeign += 1;
      return;
    }
    // 本轮（since 起）已报告过这个结局（完成行 / 对账的关闭行）→ 交给人。
    if (rowKnown(cand.buildId, pull.merged ? DONE_ROW : closedText, since)) {
      tally.settledBefore += 1;
      return;
    }
    if (pull.merged) {
      // 缺字段的已合并响应不当终态缓存：下次读不带它的 etag（304 会交回同一份）。
      if (pull.baseRef === null || pull.defaultBranch === null) {
        pullCache.delete(key);
        tally.reviewUnreadable += 1;
        return;
      }
      if (pull.baseRef !== pull.defaultBranch) {
        hintOnce(
          cand.buildId,
          `PR #${prNumber} 合并进了分支「${pull.baseRef}」，不是默认分支「${pull.defaultBranch}」，改动还没进默认分支。任务留在审核关口，由人决定下一步。`,
          since,
          tally,
        );
        return;
      }
      // 合并之后同分支又推了提交（修复轮）：那个提交不在这次合并里，不收尾。
      // head 包含 checkpoint（含 GitHub update-branch 的合并提交盖在上面）才算。
      const checkpoint =
        deps.db
          .select({ commit: step.checkpointCommit })
          .from(step)
          .where(
            and(
              eq(step.buildId, cand.buildId),
              eq(step.kind, 'build'),
              eq(step.status, 'done'),
              isNotNull(step.checkpointCommit),
            ),
          )
          .orderBy(desc(step.createdAt))
          .get()?.commit ?? null;
      if (checkpoint !== null && pull.headSha === null) {
        pullCache.delete(key); // 同上：缺字段的响应不当终态缓存
        tally.reviewUnreadable += 1; // 合并时的 head 不明，无法核对 checkpoint 在不在里面
        return;
      }
      if (checkpoint !== null && pull.headSha !== null && checkpoint !== pull.headSha) {
        const pairs = compareCache.get(key) ?? new Map();
        compareCache.set(key, pairs);
        const cmpKey = `${checkpoint}...${pull.headSha}`;
        const cached = pairs.get(cmpKey);
        let status =
          cached === undefined ||
          ((cached.status === 'missing' || cached.status === 'unreadable') &&
            now - cached.at >= CI_MISSING_COMPARE_RECHECK_MS)
            ? null
            : cached.status;
        if (status === null) {
          // 不是 40 位 SHA 时 compare 不发请求（答 invalid），不占匿名额度。
          const sendsRequest = isFullSha(checkpoint) && isFullSha(pull.headSha);
          if (token === null && sendsRequest && !takeAnonRead(now)) {
            tally.reviewSkipped += 1;
            return;
          }
          status =
            (await githubCompareStatus(
              run.githubFetch,
              token,
              target.owner,
              target.repo,
              checkpoint,
              pull.headSha,
            )) ?? 'unreadable';
          const failures = status === 'unreadable' ? (cached?.failures ?? 0) + 1 : 0;
          pairs.set(cmpKey, { status, at: now, failures });
        }
        if (status === 'unreadable') {
          // 读不到（GitHub 出错、超时、限流）：10 分钟内不重读；连续两次读不到
          // 才提示一次（一次超时之后下一次就读到的常见情形不留陈旧提示）。
          // 写提示前同样复查（㉘）：网络窗里卡离开 review、有步开始在飞或本轮已报告 → 不写。
          if ((pairs.get(cmpKey)?.failures ?? 0) >= 2 && stillOurs(cand, since)) {
            hintOnce(
              cand.buildId,
              `PR #${prNumber} 已在 GitHub 合并，但暂时读不到 compare（GitHub 出错、超时或限流），无法确认分支提交 ${checkpoint.slice(0, 7)} 在这次合并里；稍后重试。`,
              since,
              tally,
            );
          }
          tally.reviewUnreadable += 1;
          return;
        }
        if (!stillOurs(cand, since)) {
          tally.reviewSkipped += 1;
          return;
        }
        if (status !== 'ahead' && status !== 'identical') {
          const head = pull.headSha.slice(0, 7);
          const cp = checkpoint.slice(0, 7);
          hintOnce(
            cand.buildId,
            status === 'missing'
              ? `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但 GitHub 上找不到分支提交 ${cp}（可能从没推送过），无法确认它在这次合并里。任务留在审核关口。`
              : status === 'invalid'
                ? `PR #${prNumber} 已在 GitHub 合并，但执行步回报的分支提交不是有效的提交 SHA，无法核对它是否在这次合并里。任务留在审核关口。`
                : `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但分支提交 ${cp} 不是那个 head 的祖先：合并之后又推了提交，或分支被改写过。这部分改动可能还没进默认分支；任务留在审核关口，由人把这个提交另行合入默认分支。`,
            since,
            tally,
          );
          return;
        }
      }
      const detail = [
        pull.mergeCommitSha === null ? null : `合并提交 ${pull.mergeCommitSha.slice(0, 7)}`,
        pull.mergedBy === null ? null : `由 ${pull.mergedBy} 合并`,
      ].filter((x) => x !== null);
      writeSystemRow(
        cand.buildId,
        `PR #${prNumber} 已在 GitHub 合并${detail.length > 0 ? `（${detail.join('，')}）` : ''}`,
      );
      finishTodoDone(deps, cand.todoId, cand.buildId);
      tally.merged += 1;
      return;
    }
    // 关闭要隔一轮再读到才算：为重跑 CI 关掉又重开 PR 很常见，sweep 落在中间时
    // 不能把卡打成 failed、停掉它的 verify 步。
    const seen = closedSeenAt.get(key);
    if (seen === undefined || readAt - seen < CI_CLOSED_CONFIRM_MS) {
      if (seen === undefined) closedSeenAt.set(key, readAt);
      tally.reviewPending += 1;
      return;
    }
    closedSeenAt.delete(key);
    writeSystemRow(cand.buildId, closedText);
    stopUnclaimedGateSteps(deps, cand.buildId);
    failWithMessage(cand, todoRow.teamId, closedText);
    tally.closedUnmerged += 1;
  }

  async function pollOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    // 读当前 phase 再动（④）：候选是扫描快照。
    const todoRow = freshGrindRow(cand.todoId);
    if (todoRow === null) {
      tally.skipped += 1;
      return;
    }
    const buildRow = deps.db
      .select({ prNumber: build.prNumber, prUrl: build.prUrl })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = githubTarget(todoRow.projectId);
    if (buildRow === undefined || buildRow.prNumber === null || target === null) {
      // 形态不齐（PR 号缺失/项目非 github——生产不可达，防御位）：不出站、不写。
      tally.skipped += 1;
      return;
    }
    const key = `${target.fullName}#${buildRow.prNumber}`;
    grindKeys.add(key); // 先登记：在飞步跳过的这一轮不清它的缓存行
    // 有步在飞不叠派（幂等，口径见 hasActiveStep）：读到的 checks 是旧 head 的。
    if (hasActiveStep(cand.buildId)) {
      tally.skipped += 1;
      return;
    }
    const entry = cache.get(key) ?? null;
    // ref = conv 分支名（PR 的 head 即分支 tip——不逐 PR 拉 pulls/{n} 取 sha）。
    const grindToken = tokenFor(target.teamId);
    // 匿名读记进进程级额度（不拦磨绿，只让对账看见同一份 IP 额度已用了多少）。
    if (grindToken === null) recordGrindAnonRead(now);
    const page = await githubCommitCheckRuns(
      run.githubFetch,
      grindToken,
      target.owner,
      target.repo,
      conversationBranch(cand.buildId),
      {
        etag: entry?.etag ?? null,
      },
    );
    if (page === null) {
      tally.unreadable += 1; // 限流/私仓匿名/网络 = 读不到 ≠ 红：不动，下轮重试
      return;
    }
    let verdict: CheckVerdict;
    let emptySince: number | null = null;
    if (page.notModified) {
      verdict = entry?.verdict ?? { state: 'empty' }; // etag 只在有缓存行时发送，此处恒有
      emptySince = entry?.emptySince ?? now;
    } else {
      verdict = verdictOfCheckRuns(page.checkRuns);
      emptySince = verdict.state === 'empty' ? (entry?.emptySince ?? now) : null;
    }
    cache.set(key, { etag: page.etag, verdict, emptySince });
    if (verdict.state === 'pending') {
      tally.pending += 1;
      return;
    }
    if (verdict.state === 'empty') {
      if (now - (emptySince ?? now) < CI_EMPTY_CHECKS_GRACE_MS) {
        tally.pending += 1; // 竞态窗内（CI 可能还没注册 check）：不动
        return;
      }
      // 超宽限 = 仓无 CI：无可磨，按绿交人（不把无 CI 仓锁死在 building）。
    }
    // 写面前再读当前 phase（④）：网络窗内被人工推进/关闭 → 弃写。
    if (freshGrindRow(cand.todoId) === null) {
      tally.skipped += 1;
      return;
    }
    if (verdict.state === 'red') {
      const rounds = countCiFixRounds(deps.db, cand.buildId);
      if (rounds >= CI_FIX_ROUNDS_MAX) {
        // 死循环闸（③）：停手转人工——build.errorMessage 落因 + todo → failed
        // （building→failed 合法边；failed→review 恢复闸 #702 照常可用）。
        failWithMessage(cand, todoRow.teamId, deadLoopMessage(rounds));
        tally.failed += 1;
        return;
      }
      // 红 → 同 build 追加修复步（同 conv 同分支 = 原 PR 就地更新）。
      enqueueStep(
        deps,
        cand.buildId,
        'build',
        todoRow.teamId,
        buildCiFixPrompt({
          prNumber: buildRow.prNumber,
          prUrl: buildRow.prUrl,
          round: rounds + 1,
          failures: verdict.failures,
        }),
      );
      tally.appended += 1;
      return;
    }
    // 绿 → phase 推进 review 闸（通知 + chief wake 走 setTodoPhase 漏斗）。
    setTodoPhase(deps, cand.todoId, 'review');
    // #1250（ADR 0018 层 1）：CI 磨绿抵达 review 关口 = verify 入队的第二
    // 落点（第一 = completeStep 直进 review 的非 PR 面；槽空零动作幂等）。
    maybeEnqueueVerifyStep(deps, todoRow, cand.buildId);
    tally.advanced += 1;
  }

  async function sweep(now: number = nowMs()): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepOnce(now);
    } finally {
      sweeping = false;
    }
  }

  async function sweepOnce(now: number): Promise<void> {
    sweepStartedAt = nowMs();
    // 批量扫描：一条查询取全候选——prNumber 在位 × 相位 building（磨绿中；
    // review/failed/closed/done 都已退出磨绿集，天然满足「已推进不回写」）×
    // todo 的当前 build（#1403：重跑开出的新 build 在跑时，旧 PR 不再被磨）。
    const candidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'building')))
      .all();
    // #1403 review 关口候选：同为 todo 的当前 build。
    const reviewCandidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'review')))
      .all();
    const tally: CiPollTally = {
      candidates: candidates.length,
      pending: 0,
      appended: 0,
      advanced: 0,
      failed: 0,
      skipped: 0,
      unreadable: 0,
      errors: 0,
      reviewCandidates: reviewCandidates.length,
      reviewPending: 0,
      reviewSkipped: 0,
      reviewUnreadable: 0,
      reviewForeign: 0,
      merged: 0,
      closedUnmerged: 0,
      hinted: 0,
      settledBefore: 0,
    };
    grindKeys.clear();
    for (const cand of candidates) {
      try {
        await pollOne(cand, now, tally);
      } catch (err) {
        // 单候选异常不杀整轮（下轮重扫）；计数进对账行。
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'ci pr-checks poll candidate failed (sweep continues)',
        );
      }
    }
    liveKeys.clear();
    // 最久没读的先读：匿名额度不够全读时，后面的卡也轮得到。
    reviewCandidates.sort(
      (a, b) => (lastReadByBuild.get(a.buildId) ?? 0) - (lastReadByBuild.get(b.buildId) ?? 0),
    );
    for (const cand of reviewCandidates) {
      try {
        await reconcileOne(cand, now, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'pr reconcile candidate failed (sweep continues)',
        );
      }
    }
    // 离开 review / 磨绿的 PR 不再留缓存行（进程常驻，否则只增不减）。
    for (const k of cache.keys()) if (!grindKeys.has(k)) cache.delete(k);
    for (const k of pullCache.keys()) if (!liveKeys.has(k)) pullCache.delete(k);
    for (const k of anonReadAt.keys()) if (!liveKeys.has(k)) anonReadAt.delete(k);
    for (const k of compareCache.keys()) if (!liveKeys.has(k)) compareCache.delete(k);
    for (const k of closedSeenAt.keys()) if (!liveKeys.has(k)) closedSeenAt.delete(k);
    const reviewBuilds = new Set(reviewCandidates.map((c) => c.buildId));
    for (const k of lastReadByBuild.keys()) if (!reviewBuilds.has(k)) lastReadByBuild.delete(k);
    for (const k of knownRows)
      if (!reviewBuilds.has(k.slice(0, k.indexOf('\u0000')))) knownRows.delete(k);
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
