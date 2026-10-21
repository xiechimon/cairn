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
// - 有步在飞（hasActiveStep：已领取或等额度的任意步、排队中的非审核类步）
//   不叠派：读到的 checks 是推送前旧 head 的，等它跑完重评（幂等：同轮重复
//   sweep 不追加第二条）。没人领的 verify / review 步不挡磨绿与对账。
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
// 插手）。未连接 GitHub（匿名 60 次/小时）时每候选 5 分钟最多读一次。每候选
// 一次条件 GET pulls/{n}，合并后分支 head 与最后的 checkpoint 不同时再加一次
// compare（结果按 checkpoint 与 head 缓存，同一对只读一次）：
// - 已合并（不论谁合的）进了默认分支、且合并时的 head 包含最后的 checkpoint
//   → system 行写合并 SHA + done 收尾漏斗（与 merge 步成同一条）；
// - 关闭未合并 → system 行 + build.errorMessage + failed；
// - open → 不动；读不到 / 网络窗内相位被人改 → 不动（同磨绿面 ④ 纪律）。
// 每个 build 每种结局只收一次尾：本 build 已有完成行（合并步或对账收过尾）
// 就不再按「已合并」收，已有对账的关闭行就不再按「已关闭」收——人之后把卡
// 拖回 review（done→review 重开、closed→review、failed→review 恢复）是人的
// 决定。不看时钟：CI 一绿就合并（含 GitHub auto-merge）时卡在合并之后才进
// review，照样收尾。收尾时停掉没人领的 verify / review 步。

import { conversationBranch } from '@pacman/shared';
import { and, desc, eq, inArray, isNotNull, like, notInArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, message, project, step, todo } from '../db/schema.js';
import {
  type FetchLike,
  type GithubCheckRun,
  type GithubPull,
  githubCommitCheckRuns,
  githubCompareStatus,
  githubPull,
} from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  type BuildDeps,
  DONE_ROW,
  enqueueStep,
  finishTodoDone,
  maybeEnqueueVerifyStep,
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
  /** PR 已在 GitHub 合并 → done。 */
  merged: number;
  /** PR 关闭未合并 → failed。 */
  closedUnmerged: number;
  /** 已合并但分支上有合并没带走的提交，或合进了非默认分支：提示一次，不收尾。 */
  hinted: number;
  /** 本 build 已为这个结局收过一次尾（人后来把卡拖回了 review）：交给人。 */
  settledBefore: number;
}

/** PR 对账的条件读缓存行（etag + 上轮 PR 状态；304 时复用）。 */
interface PullCacheEntry {
  etag: string | null;
  pull: GithubPull | null;
}

export function createCiPoller(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: CiPollLogger },
): CiPoller {
  const cache = new Map<string, PrChecksCacheEntry>();
  const pullCache = new Map<string, PullCacheEntry>();
  /** 匿名读的上次时刻（按 PR）。 */
  const anonReadAt = new Map<string, number>();
  /** compare 结果（键 = PR + checkpoint + head；两个固定提交之间的结果不变，
   * 读到即可复用；404 除外）。 */
  const compareCache = new Map<string, string>();

  /** 本 build 有在飞的步：已被领取或在等额度的任意步，以及排队中的非审核
   * 类步。没人领的 verify / review 步不算（Verifier 的机器离线时，卡不能
   * 因此永远停在 review）。 */
  function hasActiveStep(buildId: string): boolean {
    return (
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, buildId),
            or(
              inArray(step.status, ['claimed', 'waiting_quota']),
              and(eq(step.status, 'pending'), notInArray(step.kind, ['verify', 'review'])),
            ),
          ),
        )
        .get() !== undefined
    );
  }

  function systemRows(buildId: string): unknown[] {
    return deps.db
      .select({ content: message.content })
      .from(message)
      .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
      .all()
      .map((r) => r.content);
  }

  /** 本 build 是否已为这个结局收过尾（完成行 / 对账的关闭行）。 */
  function settled(buildId: string, merged: boolean, closedText: string): boolean {
    return systemRows(buildId).includes(merged ? DONE_ROW : closedText);
  }

  /** 同一条提示只落一次（内容带提交 SHA）。 */
  function hintOnce(buildId: string, content: string, tally: CiPollTally): void {
    if (systemRows(buildId).includes(content)) return;
    insertMessageRow(deps, buildId, {
      id: newRecordId(),
      role: 'system',
      content,
      createdAt: nowMs(),
    });
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
    const buildRow = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    const target = todoRow === null ? null : githubTarget(todoRow.projectId);
    if (
      todoRow === null ||
      buildRow === undefined ||
      buildRow.prNumber === null ||
      target === null
    ) {
      tally.skipped += 1;
      return;
    }
    if (hasActiveStep(cand.buildId)) {
      tally.skipped += 1; // merge 步在飞：合并结果由它收尾
      return;
    }
    const prNumber = buildRow.prNumber;
    const key = `${target.fullName}#${prNumber}`;
    const token = tokenFor(target.teamId);
    if (token === null) {
      const last = anonReadAt.get(key);
      if (last !== undefined && now - last < CI_ANON_READ_INTERVAL_MS) {
        tally.skipped += 1;
        return;
      }
      anonReadAt.set(key, now);
    }
    const entry = pullCache.get(key) ?? null;
    const page = await githubPull(run.githubFetch, token, target.owner, target.repo, prNumber, {
      etag: entry?.etag ?? null,
    });
    if (page === null) {
      tally.unreadable += 1;
      return;
    }
    const pull = page.notModified ? (entry?.pull ?? null) : page.pull;
    pullCache.set(key, { etag: page.etag, pull });
    if (pull === null || pull.state === 'open') {
      tally.pending += 1;
      return;
    }
    // 写面前再读（④）：网络窗内相位或当前 build 变了、或有步开始在飞 → 弃写。
    const fresh = freshReviewRow(cand.todoId, cand.buildId);
    if (fresh === null || hasActiveStep(cand.buildId)) {
      tally.skipped += 1;
      return;
    }
    const closedText = `PR #${prNumber} 已在 GitHub 关闭且未合并，多半是有人决定不要这次改动。是否重做由人决定；重启任务会新开分支与 PR。`;
    if (settled(cand.buildId, pull.merged, closedText)) {
      tally.settledBefore += 1;
      return;
    }
    if (pull.merged) {
      if (pull.baseRef === null || pull.defaultBranch === null) {
        tally.unreadable += 1;
        return;
      }
      if (pull.baseRef !== pull.defaultBranch) {
        hintOnce(
          cand.buildId,
          `PR #${prNumber} 合并进了分支「${pull.baseRef}」，不是默认分支「${pull.defaultBranch}」，改动还没进默认分支。任务留在审核关口，由人决定下一步。`,
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
            and(eq(step.buildId, cand.buildId), eq(step.kind, 'build'), eq(step.status, 'done')),
          )
          .orderBy(desc(step.createdAt))
          .get()?.commit ?? null;
      if (checkpoint !== null && pull.headSha !== null && checkpoint !== pull.headSha) {
        const cmpKey = `${key}:${checkpoint}...${pull.headSha}`;
        let status = compareCache.get(cmpKey) ?? null;
        if (status === null) {
          status = await githubCompareStatus(
            run.githubFetch,
            token,
            target.owner,
            target.repo,
            checkpoint,
            pull.headSha,
          );
          if (status === null) {
            tally.unreadable += 1;
            return;
          }
          // 404 不缓存：那个提交之后可能被推上去；其余结果对两个固定提交不会变。
          if (status !== 'missing') compareCache.set(cmpKey, status);
        }
        if (
          freshReviewRow(cand.todoId, cand.buildId) === null ||
          hasActiveStep(cand.buildId) ||
          settled(cand.buildId, true, closedText)
        ) {
          tally.skipped += 1;
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
            tally,
          );
          return;
        }
      }
      const detail = [
        pull.mergeCommitSha === null ? null : `合并提交 ${pull.mergeCommitSha.slice(0, 7)}`,
        pull.mergedBy === null ? null : `由 ${pull.mergedBy} 合并`,
      ].filter((x) => x !== null);
      insertMessageRow(deps, cand.buildId, {
        id: newRecordId(),
        role: 'system',
        content: `PR #${prNumber} 已在 GitHub 合并${detail.length > 0 ? `（${detail.join('，')}）` : ''}`,
        createdAt: nowMs(),
      });
      stopUnclaimedGateSteps(deps, cand.buildId);
      finishTodoDone(deps, cand.todoId, cand.buildId);
      tally.merged += 1;
      return;
    }
    insertMessageRow(deps, cand.buildId, {
      id: newRecordId(),
      role: 'system',
      content: closedText,
      createdAt: nowMs(),
    });
    deps.db.update(build).set({ errorMessage: closedText }).where(eq(build.id, cand.buildId)).run();
    const row = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    if (row) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
    stopUnclaimedGateSteps(deps, cand.buildId);
    setTodoPhase(deps, cand.todoId, 'failed');
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
    // 有步在飞不叠派（幂等，口径见 hasActiveStep）：读到的 checks 是旧 head 的。
    if (hasActiveStep(cand.buildId)) {
      tally.skipped += 1;
      return;
    }
    const buildRow = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    const target = githubTarget(todoRow.projectId);
    if (buildRow === undefined || buildRow.prNumber === null || target === null) {
      // 形态不齐（PR 号缺失/项目非 github——生产不可达，防御位）：不出站、不写。
      tally.skipped += 1;
      return;
    }
    const key = `${target.fullName}#${buildRow.prNumber}`;
    const entry = cache.get(key) ?? null;
    // ref = conv 分支名（PR 的 head 即分支 tip——不逐 PR 拉 pulls/{n} 取 sha）。
    const page = await githubCommitCheckRuns(
      run.githubFetch,
      tokenFor(target.teamId),
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
        deps.db
          .update(build)
          .set({ errorMessage: deadLoopMessage(rounds) })
          .where(eq(build.id, cand.buildId))
          .run();
        const row = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
        if (row) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
        setTodoPhase(deps, cand.todoId, 'failed');
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
      merged: 0,
      closedUnmerged: 0,
      hinted: 0,
      settledBefore: 0,
    };
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
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
