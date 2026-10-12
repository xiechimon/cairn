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
// - 扫描面批量（一条 DB 查询取全候选）+ 条件请求（每轮每候选恰好 1 个
//   If-None-Match 条件 GET，304 复用缓存判据），禁止逐 PR 全量拉——GitHub
//   无跨 PR 批量端点，条件 GET 是最小合规形；429/404/网络 = fail-open 不动，
//   下轮重试（读不到 ≠ 红）；
// - build 已被人手动推进/关闭时不得回写：候选是扫描快照，动作前重读当前
//   phase（两次：网络读之前、写面之前——网络窗是人工动作最可能落进的缝）；
// - 修复步在飞（pending/claimed）不叠派：读到的 checks 是推送前旧 head 的，
//   等它跑完重评（幂等：同轮重复 sweep 不追加第二条）。
//
// 磨绿入口（completeStep 的 build 分支，builds.ts）：PR 交付（prNumber 在）
// 的执行步成 → 停在 building（本模块推进 review）；无 PR → 既有直进 review
// 不变。空 checks 宽限：PR head 上一条 check 都没有 = 「仓没配 CI」与「CI
// 还没注册 check（竞态）」不可分——宽限内按 pending 等，超宽限按绿交人
// （不把无 CI 仓永远锁在 building）。

import { conversationBranch } from '@pacman/shared';
import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, project, step, todo } from '../db/schema.js';
import { type FetchLike, type GithubCheckRun, githubCommitCheckRuns } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, enqueueStep, maybeEnqueueVerifyStep, toBuildRecord } from './builds.js';
import { openGithubToken } from './github-connection.js';
import { setTodoPhase } from './todos.js';

/** 轮询节奏（票面：60s 扫）。 */
export const CI_POLL_INTERVAL_MS = 60_000;

/** 死循环闸阈值：同一 build 连续修复 N 轮仍红 → 停手转人工。 */
export const CI_FIX_ROUNDS_MAX = 3;

/** 空 checks 宽限（[设计]：够 GitHub Actions 在新 head 上注册 check；仓真没
 * CI 时延迟到此推闸交人）。 */
export const CI_EMPTY_CHECKS_GRACE_MS = 300_000;

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
}

export function createCiPoller(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: CiPollLogger },
): CiPoller {
  const cache = new Map<string, PrChecksCacheEntry>();

  /** 读当前 phase，不在磨绿集 = 不动（④：已被人工推进/关闭/终态）。 */
  function freshGrindRow(todoId: string) {
    const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
    return row !== undefined && row.phase === 'building' ? row : null;
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
    // 修复步在飞不叠派（幂等）：pending/claimed 在跑 = 读到的 checks 是旧 head 的。
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, cand.buildId), inArray(step.status, ['pending', 'claimed'])))
      .get();
    if (active !== undefined) {
      tally.skipped += 1;
      return;
    }
    const buildRow = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    const projRow = deps.db.select().from(project).where(eq(project.id, todoRow.projectId)).get();
    if (
      buildRow === undefined ||
      buildRow.prNumber === null ||
      projRow === undefined ||
      projRow.repoKind !== 'github' ||
      projRow.githubRepo === null
    ) {
      // 形态不齐（PR 号缺失/项目非 github——生产不可达，防御位）：不出站、不写。
      tally.skipped += 1;
      return;
    }
    const slash = projRow.githubRepo.indexOf('/');
    const owner = projRow.githubRepo.slice(0, slash);
    const repo = projRow.githubRepo.slice(slash + 1);
    // token 阶梯（#931 同律）：连接 token → 匿名（公开仓可达）；box 缺席/密文
    // 损坏按未连接（轮询是辅助面，不把 500 打进调度循环）。
    let token: string | null = null;
    if (deps.box !== undefined) {
      try {
        token = openGithubToken({ db: deps.db, box: deps.box }, projRow.teamId);
      } catch {
        token = null;
      }
    }
    const key = `${projRow.githubRepo}#${buildRow.prNumber}`;
    const entry = cache.get(key) ?? null;
    // ref = conv 分支名（PR 的 head 即分支 tip——不逐 PR 拉 pulls/{n} 取 sha）。
    const page = await githubCommitCheckRuns(
      run.githubFetch,
      token,
      owner,
      repo,
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
    // review/failed/closed/done 都已退出磨绿集，天然满足「已推进不回写」）。
    const candidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, eq(todo.id, build.todoId))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'building')))
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
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
