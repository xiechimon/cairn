// build 服务面（02 §4.2/A6 锁定语义）：
// - 实体等式：一次运行 = 一个 build = 一个 conversation；buildId ≡ conversationId
//   （UUIDv7，r3 §3.0）。
// - step 队列 server 持有、机器 claim：POST builds → 入队规划步（withPlan）或
//   执行步（直执行）；确认 → 入队执行步；驳回 → 入队重规划步（同 conv
//   continue session，执行在 M3）；merge → 202 delegated + 入队合并步；GitHub
//   形态、build 记着 PR 时 merge = server 经 GitHub API 合并 PR（#1403 段 2b），
//   线形同为 202 delegated。
// - 失败仅人工重跑（r3 §3.7）：重跑 = 新 POST builds（新 conv/新 build）。
// 机器侧执行（claim/心跳/phase 推进 planning→confirm→…）归 M3；本层只持有
// 队列与人工触发的 phase 流转。

import type {
  Assignment,
  BuildRecord,
  GithubRepoRef,
  Phase,
  ReviewGate,
  ReviewVerdict,
  SecretBox,
  StepJournalRow,
  StepKind,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@pacman/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  buildFallbackReport,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildReviewStepPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  buildTaskPromptText,
  buildVerifyStepPrompt,
  CONFIRM_ANNOUNCEMENT,
  checkPlanContract,
  conversationBranch,
  hasBlockingFinding,
  isPlanContractRewritePrompt,
  MERGE_ANNOUNCEMENT,
  type PlanContractCheck,
  parseGithubIssueSourceRef,
  personaByRole,
  planVerificationItems,
  REVIEW_ANNOUNCEMENT,
  REVIEW_FANOUT_ROLES,
  REVIEW_VERDICT_KIND,
  reconcileVerifyVerdict,
  STOP_MESSAGE,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
} from '@pacman/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  machine,
  message,
  plan as planTable,
  project,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubMergeResult,
  githubMergePull,
  githubPull,
  githubPullState,
  hasPullFields,
  isFullSha,
  isOwnPull,
  WRITE_AUTHOR_ASSOCIATIONS,
} from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { agentForStep } from './dispatch-eligibility.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { githubRepoOfProject, hasRepoBinding, projectOfTodo, readBuildChanges } from './git.js';
import { githubTokenOrNull, teamGithubToken } from './github-connection.js';
import { githubText } from './github-text.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
// #1261 配额挂起投影单源（listSteps 的 waiting_quota 行）。
import { publishStepRow, toQuotaWait } from './quota-wait.js';
import { stepQueueProjector } from './step-queue.js';
import {
  childrenOfTodo,
  getTodo,
  setTodoPhase,
  settleSplitOnDone,
  splitBlockersSatisfied,
} from './todos.js';
// #902：transcript 行写入单源提出（todos 面同用，避免 todos→builds 依赖环）。
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';

export interface BuildDeps {
  db: Db;
  hub: TeamStreamHub;
  /** 机器 wake 通道（入队即唤醒 claim 长轮询 + machine stream，02 §5.4）；
   * 缺省 = 无机器面（M2a 编排测试形态）。 */
  machineHub?: MachineWakeHub;
  /** 通知收件人（completeStep 经 setTodoPhase 漏斗发三事件，02 §9.1）。 */
  user: UserRecord;
  /** conversation stream 通道（M5 live streaming：入队步/驳回与合并用户行
   * 即时推送，02 §1.2 会话流）；缺省 = 无会话流面。 */
  convHub?: ConversationStreamHub;
  /** 托管 bare repo 根（#511 审核关口变更材料 = readBuildChanges 的计算位；
   * 缺省 = 无变更面（读不到 = 材料如实写「无改动」）。 */
  reposDir?: string;
  /** #931 返工复用判定：github PR 状态探测的 token 解密位
   * （openGithubToken 同族）；缺省 = 匿名探测（公开仓可达）。 */
  box?: SecretBox;
  /** #931：GitHub 出站注入位（AppContext.githubFetch 同族；缺省
   * globalThis.fetch，测试注入 mock——零真实出站）。 */
  githubFetch?: FetchLike;
}

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

export function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    todoId: row.todoId,
    withPlan: row.withPlan,
    prevPhase: row.prevPhase ?? null,
    triggerSource: row.triggerSource,
    planDocId: row.planDocId,
    errorMessage: row.errorMessage,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    diffHash: row.diffHash,
    createdAt: row.createdAt,
  };
}

function publishBuild(deps: BuildDeps, row: BuildRow): BuildRecord {
  const record = toBuildRecord(row);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow) deps.hub.publishBuildDoc(todoRow.teamId, record);
  return record;
}

/** steer 写面（W3 #278，06 册 D9）：build 会话运行中补话——claimed 步门
 * （无在跑步 = 409 不静默，spec #277「agent 不在跑时发送要被明确拒绝」）+
 * 单槽 pending upsert（双发覆盖）+ transcript user 行（insertMessageRow 同形）
 * + machine steer 信号（拉取-确认投递的触发沿，services/machines）。 */
export function sendBuildSteer(
  deps: BuildDeps,
  conversationId: string,
  body: { content: string },
): { message: { id: string; role: 'user'; content: string; createdAt: number } } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, conversationId)).get();
  if (!buildRow) throw new HttpError(404, `conversation ${conversationId}`);
  // activeRun 门 = 该会话存在已领取未收尾的步（agent 在跑）；plan/build/merge
  // 步序贯，取最新 claimed。
  const running = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, conversationId), eq(step.status, 'claimed')))
    .all()
    .at(-1);
  if (!running) {
    throw new HttpError(409, 'no active step on this conversation (steer 只对运行中的会话生效)');
  }
  const now = nowMs();
  const messageRow = {
    id: newRecordId(),
    role: 'user' as const,
    content: body.content,
    createdAt: now,
  };
  insertMessageRow(deps, conversationId, messageRow);
  db.insert(steerPending)
    .values({ conversationId, stepId: running.id, content: body.content, createdAt: now })
    .onConflictDoUpdate({
      target: steerPending.conversationId,
      set: { stepId: running.id, content: body.content, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.steerSignal(todoRow.teamId, running.id);
  return { message: messageRow };
}

/** GET /conversations/{id}/messages 的 build 分支 steerPending 读位（单槽
 * 内容数组化——封套数组形观测，r5 §3.6）。 */
export function readSteerPending(db: Db, conversationId: string): string[] {
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, conversationId))
    .get();
  return pending ? [pending.content] : [];
}

/** #1247 stop-then-done：delegated stop 完成后的目标相位（进程内）。
 *  重启后丢失 = 回落 gate（与普通 stop 同面），不另开 migration。
 *  #1445 `keep`：卡已被写离执行中（关闭 / 挪回待开始），回报只落步与 build，
 *  不动相位。 */
const afterStopPhaseByBuild = new Map<string, Phase | 'keep'>();

/** #1445 / #1451 / #1453：卡已被人写离执行中（关闭 / 标完成 / 挪回待开始）。
 *  停止回报与迟到的成功回报都不再改写这几个相位。 */
function hasLeftExecution(phase: Phase): boolean {
  return phase === 'closed' || phase === 'done' || phase === 'todo';
}

/** #1247 预定相落地（停止回报 × 停止在途时步先跑完 两面单源）：直写预定相
 *  （queued/planning→done 不在前进漏斗；与 gate 回落同形）；done 额外挂
 *  settle + 波次（成功交付；failed 源不会走 stop-then-done）。 */
function landReservedPhase(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  desired: Phase,
): void {
  if (todoRow.phase !== desired) {
    deps.db
      .update(todo)
      .set({ phase: desired, phaseAt: nowMs(), v: todoRow.v + 1 })
      .where(eq(todo.id, todoRow.id))
      .run();
    const record = getTodo(deps, todoRow.id);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (desired === 'done') {
    settleSplitOnDone(deps, todoRow.id);
    advanceSplitWaves(deps, todoRow.id);
  }
}

/** 停止写面（M7 #308，r9 §3.3 停止钮 / 08 册附录 A composer 停止钮行）：
 * POST /api/builds/{id}/stop body {discard}——中断当前活动步。
 * - claimed 步 = 机器信号面（stop_pending 单槽 upsert + machine stream stop
 *   事件 → GET /api/machine/stop 拉取-确认 → daemon live.stop()，#278 steer
 *   同律）→ {delegated:true} 202；中断在途，done(stopped) 回报才落账。
 * - pending / waiting_quota 步（#1261）= 无机器可通知，server 侧即时取消 →
 *   {delegated:false} 200（配额挂起步无 daemon 在跑，停 = 放弃挂起）。
 * 无活动步 = 409 不静默（steer 门同律）。 */
export function requestStop(
  deps: BuildDeps,
  buildId: string,
  body: { discard: boolean },
): { delegated: boolean } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  // 活动步 = pending/claimed/waiting_quota（步序贯，取最新一条；orderBy 显式
  // 钉死语义，不依赖隐式 rowid 序）。
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    throw new HttpError(409, 'no active step on this build (stop 只对运行中的任务生效)');
  }
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    return { delegated: false };
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: body.discard, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: body.discard, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { delegated: true };
}

/** gate 回落目标（r9 §3.3「todo 落上一完成 turn 的 gate」的 build 内投影
 * [设计]——pacman 重跑 = 新 build 新会话新分支，跨 build 回落会指向旧会话的
 * 变更面（latestBuildId 已换），故回落以本 build 为界）：最近 done 步的
 * 关口（plan→confirm / build|merge→review）；无 done 步 → build.prevPhase
 * （回到本轮开始前的面：fresh→todo、失败重跑→failed、定时复跑→done…）。 */
function stopFallbackPhase(db: Db, buildRow: BuildRow): Phase {
  const lastDone = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildRow.id), eq(step.status, 'done')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (lastDone) return lastDone.kind === 'plan' ? 'confirm' : 'review';
  return buildRow.prevPhase ?? 'todo';
}

/** 停止落账（pending 步即时取消 × done(stopped) 机器回报两面单源）：
 * step stopped + build.errorMessage 取消标记（STOP_MESSAGE，运行历史面数据源）
 * + gate 回落 + stop_pending 清理 + 会话流/文档事件推送。
 * 回落绕过 setTodoPhase 漏斗 [设计]：取消回退边不在前进流转表（如
 * building→confirm、planning→todo），且取消是用户在场动作——不触发
 * confirm/review 进入通知与 chief wake（重复通知 = 误导）。 */
export function applyStoppedStep(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  db.update(step).set({ status: 'stopped', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
  // #1247：stop-then-done 预定相位优先；否则 gate 回落（普通停止钮）。
  const desired = afterStopPhaseByBuild.get(buildRow.id);
  afterStopPhaseByBuild.delete(buildRow.id);
  // #1445：相位归把卡写离执行中的那一手；回报前被重开的卡也不被回落覆盖。
  if (desired === 'keep') return;
  if (desired != null) {
    landReservedPhase(deps, todoRow, desired);
    return;
  }
  // keep 预定丢失（进程重启）时的兜底：已离开执行中的卡不被 gate 回落改写。
  if (hasLeftExecution(todoRow.phase)) return;
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  db.update(todo)
    .set({ phase: target, phaseAt: nowMs(), v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

// —— #1219 queued build 取消/僵尸释放（chief cancel_builds 的漏斗单源）—————

/** 僵尸 queued todo 释放（cancelBuild 无活动步分支与 sweepZombieQueuedTodos
 * 共用）：todo 卡在 queued 而 latest build 已无 pending/claimed 步 = 占着
 * 调度位不可再入（run_builds 的 queued→queued 断言 409）。释放 = 回落
 * stopFallbackPhase（与 stop 漏斗同面：最近 done 步关口 / prevPhase / todo）
 * + build.errorMessage 兜底（已写原因保留）+ build/todo 事件。回落直写 todo
 * （applyStoppedStep 同律：取消回退边不在前进流转表，不触发关口通知与
 * chief wake）。幂等：todo 非 queued 或已落目标相位 = no-op。 */
function releaseZombieQueued(
  deps: BuildDeps,
  buildRow: BuildRow,
  todoRow: typeof todo.$inferSelect,
): void {
  const { db } = deps;
  if (todoRow.phase !== 'queued') return;
  if (buildRow.errorMessage === null) {
    db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  }
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  db.update(todo)
    .set({ phase: target, phaseAt: nowMs(), v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
  const fresh = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (fresh) publishBuild(deps, fresh);
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

/** #1219 chief/mcp cancel_builds 的取消漏斗（替代旧裸 UPDATE——只写
 * build.errorMessage + pending 步 failed、todo 不离 queued 的僵尸形）：
 * - pending 步 → applyStoppedStep（与用户 stop 面同账：步 stopped + build
 *   errorMessage「已取消」+ todo 回落 + 事件）；
 * - claimed 步 → stop 委托（stopPending 单槽 + machine stream stop 事件，
 *   done(stopped) 回报落账）——在跑步不再零通知地占并发位；
 * - 无活动步（已终态/僵尸）→ releaseZombieQueued 幂等释放；
 * - build 不存在 → not-found（调用方按需 404）。返回值 = 各形态回执。 */
export function cancelBuild(
  deps: BuildDeps,
  buildId: string,
): 'stopped' | 'delegated' | 'released' | 'not-found' {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return 'not-found';
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) return 'released';
    releaseZombieQueued(deps, buildRow, todoRow);
    return 'released';
  }
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    return 'stopped';
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return 'delegated';
}

/** #1219 存量僵尸 reconcile（scheduler tick + 启动各一次）：todo phase =
 * queued 但 latest build 已无 pending/claimed 步 = 「占调度位却无事可领」
 * （旧 cancel 裸 UPDATE / 崩溃窗口的遗留态）。修复 = releaseZombieQueued
 * 回落释放；活步控制组（有 pending/claimed 步）不动。无龄判据：僵尸不是
 * 过渡态——startBuilds 的建 build/入队/置 queued 与 claim 的置 claimed/推
 * 相位都是同步块，合法流转不会产出「queued 无活步」的中间窗。 */

/** #1247：停止活动步但不改相位（pending/waiting_quota 即时；claimed 不走这里）。 */
function stopStepKeepPhase(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  db.update(step).set({ status: 'stopped', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
}

/** #1403：PR 对账收尾（done / failed）时停掉本 build 还没人领的 verify /
 * review 步（排队中或等额度挂起）——卡已收尾，它们之后再被领走就是在已收尾的
 * 卡上跑（blocking 审核会把 done 往 planning 推而抛错）。只改步状态，不写
 * build.errorMessage（不是用户停止，收尾原因由对账自己的行说明）。 */
export function stopUnclaimedGateSteps(
  deps: BuildDeps,
  buildId: string,
): (typeof step.$inferSelect)['kind'][] {
  const rows = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.status, ['pending', 'waiting_quota']),
        inArray(step.kind, ['verify', 'review']),
      ),
    )
    .all();
  for (const row of rows) {
    const finishedAt = nowMs();
    deps.db.update(step).set({ status: 'stopped', finishedAt }).where(eq(step.id, row.id)).run();
    publishStepRow(deps, { ...row, status: 'stopped', finishedAt });
  }
  // 停掉的步的种类（#1403 段 3：解冲突轮据此决定要不要落「AI 审核步已停」的行）。
  return rows.map((r) => r.kind);
}

export type StopAndMarkDoneResult = { state: 'ready' } | { state: 'stopping' };

/** #1247 stop-then-done 的停半边：pending 即时停且保相位；claimed 委托停并
 *  预定 afterStop=done。调用方在 ready 时再写 phase=done。无活动步 = ready。 */
export function prepareStopForDone(deps: BuildDeps, todoId: string): StopAndMarkDoneResult {
  return prepareStopFor(deps, todoId, 'done');
}

/** #1445 卡被写离执行中之后的停半边：关闭（closed），被 raw PATCH 挪回待开始
 *  或标完成（web 走 /reset 与 stop-and-done），或经 complete_todos 标完成
 *  （#1451）。停掉 latest build 的活动步：pending / waiting_quota
 *  即时停，不再可领、不占队列位次；claimed 委托停并预定 keep，回报
 *  done(stopped) 时 applyStoppedStep 不动相位。无 latest build / 无活动步 =
 *  no-op。 */
export function stopActiveStepsAfterExit(deps: BuildDeps, todoId: string): void {
  prepareStopFor(deps, todoId, 'exit');
}

function prepareStopFor(
  deps: BuildDeps,
  todoId: string,
  after: 'done' | 'exit',
): StopAndMarkDoneResult {
  const { db } = deps;
  const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${todoId}`);
  if (todoRow.latestBuildId == null) return { state: 'ready' };
  const buildId = todoRow.latestBuildId;
  // 卡已离开执行中：先前 stop-and-done 留下的 done 预定作废，否则回报落账
  // 会把刚关掉的卡写成 done。
  if (after === 'exit') afterStopPhaseByBuild.delete(buildId);
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) return { state: 'ready' };
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    stopStepKeepPhase(deps, active.id);
    return { state: 'ready' };
  }
  const now = nowMs();
  // exit 预定 keep 而非目标相：卡此刻已在调用方写的相位，回报前被重开的卡
  // 不该被再关一次，也不该被 gate 回落覆盖。
  afterStopPhaseByBuild.set(buildId, after === 'done' ? 'done' : 'keep');
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { state: 'stopping' };
}

export function sweepZombieQueuedTodos(deps: BuildDeps, _now: number = nowMs()): number {
  const rows = deps.db.select().from(todo).where(eq(todo.phase, 'queued')).all();
  let released = 0;
  for (const todoRow of rows) {
    if (todoRow.latestBuildId === null) continue; // 无 build 的 queued 不属本面
    const buildRow = deps.db.select().from(build).where(eq(build.id, todoRow.latestBuildId)).get();
    if (!buildRow) continue;
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildRow.id),
          inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
        ),
      )
      .all();
    if (active.length > 0) continue;
    releaseZombieQueued(deps, buildRow, todoRow);
    released += 1;
  }
  return released;
}

// #1150 起对 services/ci-loop.ts 导出（CI 磨绿环的修复步追加复用同一入队面）。
export function enqueueStep(
  deps: BuildDeps,
  buildId: string,
  kind: StepRecord['kind'],
  teamId: string,
  /** [内部] 续轮指令（step.prompt）：驳回 feedback 注入重规划轮（r5 §4「v2
   * 忠实执行反馈」的宿主等价物）；claim 载荷 instruction 位透出。 */
  prompt?: string,
  /** [内部] #931 返工轮边界：本步强制新引擎会话（claim session.action='new'
   * + 会话亲和闸放行）。置位 = restart 复用 PR build 的首步；后续步照常续接
   * 本轮新开的会话。 */
  freshSession?: boolean,
): StepRecord {
  const id = newRecordId(); // base64 样 21 字符（r5 §3.1 claim step=…）
  const createdAt = nowMs();
  deps.db
    .insert(step)
    .values({
      id,
      buildId,
      kind,
      machineId: null,
      status: 'pending',
      prompt: prompt ?? null,
      freshSession: freshSession === true,
      createdAt,
    })
    .run();
  // 入队即 wake（低延迟派发，02 §1.2/§5.4；claim 长轮询等待者 + SSE 双通道）。
  deps.machineHub?.wake(teamId);
  // 会话流 step 事件（pending）：详情页进度行即时更新（M5 live streaming）。
  // #1106：pending 步无注入选择（选择在 claim 时计算）——skillInjection 恒
  // null，claim 后的 step 事件（publishStepStatus）携带真值。
  deps.convHub?.publishStep(buildId, {
    id,
    buildId,
    kind,
    machineId: null,
    createdAt,
    status: 'pending',
    checkpointCommit: null,
    skillInjection: null,
  });
  return { id, buildId, kind, machineId: null, createdAt };
}

export function getBuild(deps: BuildDeps, id: string): BuildRecord | null {
  const row = deps.db.select().from(build).where(eq(build.id, id)).get();
  return row ? toBuildRecord(row) : null;
}

// steps 读面行 = shared stepJournalRowSchema 单源（record + journal 位透出
// [设计]，02 §5.4「journal 状态字段归实现期展开」；zod strip 下 record 对拍
// 不漂移）。

export function listSteps(deps: BuildDeps, buildId: string): StepJournalRow[] {
  const rows = deps.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .orderBy(asc(step.createdAt))
    .all();
  // 排队投影（#1108）：pending 行挂 queue（位次 + 等待对象）——详情页
  // transcript 的「排队中」行数据源。build 域投影器一次构造（steps 行集
  // 共用）；build/todo 行缺失（防御位）= pending 行无投影，呈现回落既有
  // 标签。
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  let queueById: Map<string, StepJournalRow['queue']> | null = null;
  if (pendingIds.length > 0 && buildRow !== undefined) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow !== undefined) {
      const projector = stepQueueProjector(deps.db, todoRow.teamId);
      queueById = new Map(
        rows.map((r) => {
          if (r.status !== 'pending') return [r.id, undefined];
          const projected = projector.project({
            id: r.id,
            createdAt: r.createdAt,
            homeMachineId: agentForStep(deps.db, todoRow, r.kind, r.prompt)?.machineId ?? null,
            holdReason: r.holdReason,
            holdUntil: r.holdUntil,
          });
          return [r.id, projected ?? undefined];
        }),
      );
    }
  }
  return rows.map((r) => ({
    id: r.id,
    buildId: r.buildId,
    kind: r.kind,
    machineId: r.machineId,
    createdAt: r.createdAt,
    status: r.status,
    checkpointCommit: r.checkpointCommit,
    ...(queueById?.get(r.id) !== undefined ? { queue: queueById.get(r.id) } : {}),
    // #1106 注入选择记录（详情面回查正本）：null = 未计算（chief 步/旧
    // 数据），hits=[] = 已计算零命中。
    skillInjection: r.skillInjection ?? null,
    // #1261 配额挂起投影（waiting_quota 行携带——详情页「等额度」进度行
    // 数据源；投影单源 = services/quota-wait.ts toQuotaWait）。
    ...(r.status === 'waiting_quota' && r.quotaBlock !== null
      ? { quotaWait: toQuotaWait(r.quotaBlock) }
      : {}),
  }));
}

/** 开始/重跑：POST /api/projects/{id}/builds body {todoIds[], assignment,
 * withPlan}（r5 §3.4 人工启动抓包原样；todoIds 数组 = 批量形状）。
 * 每 todo：phase→queued（重跑自 failed 同边，r3 §3.7）+ 建 build（UUIDv7，
 * triggerSource 记录）+ 入队首步。 */
export function startBuilds(
  deps: BuildDeps,
  input: {
    projectId: string;
    todoIds: string[];
    assignment: Assignment;
    withPlan: boolean;
    triggerSource?: TriggerSource; // 默认 user；schedule = 定时触发（services/scheduler.ts）；chief 面归 M4
  },
): BuildRecord[] {
  const triggerSource = input.triggerSource ?? 'user';
  // 归属校验先于任何建 build（#1497）：任务须属该项目，项目须与任务同队——
  // 本队任务指向他队项目（#1466 前 create_todo 可造）按项目不存在处理。
  // 所有调用方（REST、定时、chief、MCP）都经这里。相位校验仍在下方逐卡现读
  // （同一 id 重复出现时第二次读到 queued，照旧 409）。
  const projectRow = deps.db.select().from(project).where(eq(project.id, input.projectId)).get();
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord || todoRecord.projectId !== input.projectId) {
      throw new NotFoundError(`todo ${todoId}`);
    }
    if (projectRow?.teamId !== todoRecord.teamId) {
      throw new NotFoundError(`project ${input.projectId}`);
    }
  }
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord) throw new NotFoundError(`todo ${todoId}`);
    // todo → queued（02 §4.1：已启动，等空闲机器）。
    assertPhaseTransition(todoRecord.phase, 'queued');
    const id = newUuidv7(); // buildId ≡ conversationId（UUIDv7，r3 §3.0）
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id,
        todoId,
        withPlan: input.withPlan,
        prevPhase: todoRecord.phase,
        triggerSource,
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    // 首步：先做规划 = 规划步；立即执行 = 执行步（02 §4.2 开始 dialog 两分支）。
    enqueueStep(deps, id, input.withPlan ? 'plan' : 'build', todoRecord.teamId);
    setTodoPhase(deps, todoId, 'queued', {
      assignment: input.assignment,
      latestBuildId: id,
      lastRunAt: createdAt,
    });
    const row = deps.db.select().from(build).where(eq(build.id, id)).get();
    if (!row) throw new Error('build missing after insert');
    created.push(publishBuild(deps, row));
  }
  return created;
}

// —— #1250 verify 步入队（ADR 0018 层 1：review 关口抵达 → Verifier 派发）——————

/** verify 步入队（#1250）：build 抵达 review 关口（直接落地或 CI 磨绿推进）
 * 且 assignment.verify 槽在位时入队一条验证步——额外 agent 步不推进主时序
 * （review 同律：phase 留 review 关口，合并闸留人）。幂等：本 build 已有
 * verify 步（任意状态）不再入——重跑 = 新 build 新会话自然重验。
 * 槽空 = 零动作（存量任务/未配 Verifier 的任务行为逐字节不变）。 */
export function maybeEnqueueVerifyStep(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  buildId: string,
  /** reverify：之后有过解冲突轮（PR 对账把默认分支合进了交付，#1403 段 3），之前的 verify
   * 步（停掉的或已跑完的）验的是冲突前的提交——只要没有排队或在跑的 verify 步就再排一条。
   * 缺省每个 build 一条。 */
  opts: { reverify?: boolean } = {},
): void {
  const verifyAgentId = todoRow.assignment?.verify?.agentId;
  if (verifyAgentId == null) return;
  const existing = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'verify'),
        ...(opts.reverify === true
          ? [inArray(step.status, ['pending', 'claimed', 'waiting_quota'])]
          : []),
      ),
    )
    .get();
  if (existing !== undefined) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return;
  // 票号段（#1250 票面：docs/verify/<票号>/）：github 关联任务 = issue 号
  //（sourceRef 单源反解）；无关联 = seqNum（本地仓的同一约定位）。
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const ticketRef = String(linked?.issueNumber ?? todoRow.seqNum);
  const planRow = latestPlanRow(deps, buildId);
  const prompt = buildVerifyStepPrompt({
    ticketRef,
    // #1406：GitHub issue 导入任务的标题与正文进 issue 原文围栏（ADR 0021 D5）。
    taskText: buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),
    planText: planRow?.content ?? '',
    // #1492：方案 Verification 清单逐项进材料（无清单 = 老方案 / 直执行，按旧口径）。
    verificationItems: planVerificationItems(planRow?.content ?? ''),
    pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
  });
  insertGateAnnouncement(deps, buildId, VERIFY_ANNOUNCEMENT, deps.user.displayName);
  enqueueStep(deps, buildId, 'verify', todoRow.teamId, prompt);
}

/** 拆卡波次推进（#1250 / ADR 0018 层 2）：子卡 done 落地时，检查同父兄弟里
 *  「phase=todo 且阻塞全解」的卡并自动派发（直执行 withPlan=false——方案
 *  已在父卡 confirm 人审过，逐卡再 confirm 会淹没人工闸；review/merge 闸
 *  逐卡留人）。失败单卡跳过不中断批次（非法相位等竞态窗记 skipped——与
 *  transitionTodos 的批次容错同形）。 */
export function advanceSplitWaves(deps: BuildDeps, childTodoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, childTodoId)).get();
  if (row === undefined || row.sourceTodo === null) return;
  const ready = childrenOfTodo(deps.db, row.sourceTodo).filter(
    (c) => c.phase === 'todo' && splitBlockersSatisfied(deps.db, c),
  );
  for (const child of ready) {
    const assignment = child.assignment ?? { plan: null, build: null };
    if (assignment.build == null) continue;
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        assignment,
        withPlan: false,
        triggerSource: 'chief',
      });
    } catch {
      // 竞态窗（todo 被并发推进）单卡跳过：波次推进是加法回路，重试面 =
      // 下一个兄弟 done 或人工 dispatch；不整批中断。
    }
  }
}

/** 拆卡父确认派发（#1250）：confirm 落在拆卡父上（有子项的 confirm）= 派发
 *  无阻塞子卡（直执行）+ 父进 building（伞形在飞），不是入队 build 步——
 *  父的「执行」就是子卡们的执行。返回派发张数（0 = 全阻塞的非法形：DAG
 *  必有源点，正常恒 ≥1）。 */
export function dispatchSplitChildren(deps: BuildDeps, parentId: string): number {
  const ready = childrenOfTodo(deps.db, parentId).filter(
    (c) => c.phase === 'todo' && splitBlockersSatisfied(deps.db, c),
  );
  let dispatched = 0;
  for (const child of ready) {
    const assignment = child.assignment ?? { plan: null, build: null };
    if (assignment.build == null) continue;
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        assignment,
        withPlan: false,
        triggerSource: 'chief',
      });
      dispatched += 1;
    } catch {
      // 单卡失败跳过（advanceSplitWaves 同律）。
    }
  }
  return dispatched;
}

// —— #931 返工目标判定（restart 分支消费）———————————————————————————

/** todo 最新的「产过 PR 的 build」（prUrl/prNumber 任一非空 = daemon 步收尾
 * 探测回填在位，github 形态独有）。更旧的 PR build 属被取代分支（存量收敛
 * 规则 = spec 23）；无 → null（返工走现行新 build 路）。 */
function latestPrBuild(db: Db, todoId: string): BuildRow | null {
  return (
    db
      .select()
      .from(build)
      .where(and(eq(build.todoId, todoId), or(isNotNull(build.prUrl), isNotNull(build.prNumber))))
      .orderBy(desc(build.createdAt))
      .all()
      .at(0) ?? null
  );
}

/** 出站 PR 状态探测的公共半边（#931 / #1217 共用）：项目形态闸 + owner/repo
 *  拆分 + token 阶梯。非 github 形态或 prNumber 缺位（无从探测）→ null，
 *  fail-open 语义归各调用方。timeoutMs 缺省回落 githubPullState 自带值
 *  （#1217 claim 热路径传 5s 短预算，#931 restart 非热路径用缺省）。 */
async function probePullState(
  deps: BuildDeps,
  teamId: string,
  projectId: string,
  prNumber: number,
  timeoutMs?: number,
): Promise<{ state: 'open' | 'closed'; merged: boolean } | null> {
  const projRow = projectOfTodo(deps.db, { projectId, teamId });
  // 非 github 形态或 githubRepo 不合法（#1466：`.` / `..` 段改写请求路径）→ 不探测。
  const repoRef = githubRepoOfProject(projRow);
  if (repoRef === null) return null;
  const { owner, repo } = repoRef;
  // token 阶梯：github_connection（已连接）→ 匿名（公开仓可达）。
  const token = githubTokenOrNull(deps, teamId);
  return githubPullState(deps.githubFetch ?? fetch, token, owner, repo, prNumber, timeoutMs);
}

/** 复用目标的 PR 状态判定（#931 失败方式 3）：open / 探测不到 → null（复用
 * ——探测失败时盲开新分支会把本票的 bug 原样带回来，而误复用已合并分支只是
 * 提交落旧分支〔可见、可收拾〕，代价不对称）；closed → 'merged' | 'closed'
 * （允许新分支，判定经 note 可见）。探测只对 github 形态项目出站（hosted/
 * local 生产不落 PR 字段，探测无从下手——直插/存量形态 fail-open 复用）；
 * prNumber 缺位的存量形（仅 prUrl）不猜号，fail-open 复用。 */
async function probeReworkTargetPr(
  deps: BuildDeps,
  target: BuildRow,
  todo: { projectId: string; teamId: string },
): Promise<'merged' | 'closed' | null> {
  if (target.prNumber === null) return null;
  const state = await probePullState(deps, todo.teamId, todo.projectId, target.prNumber);
  if (state === null || state.state === 'open') return null;
  return state.merged ? 'merged' : 'closed';
}

// —— #1217 同 todo 第二张 PR 守卫判定（claim / merge / done 回填三面消费）———

/** 守卫探测超时（claim 热路径版）：5s 上界——claim 长轮询预算（daemon
 *  REQUEST_TIMEOUT_MS = HOLD_MS + 15s）内绰绰有余，慢网至多延迟一步 claim，
 *  不拖死整轮。 */
const MERGED_PR_GUARD_PROBE_TIMEOUT_MS = 5_000;

/** 同 todo 已合并 PR 探测（#1217）：todoId 下除 excludeBuildId 外的更早 PR
 *  build（prUrl/prNumber 任一非空），按 createdAt 降序逐个出站探测，merged
 *  真值命中即返回该 build 的 PR 字段（prNumber 恒非空——缺位行被跳过，调用
 *  方点名 PR 无需再判 null）；全部 open / closed-unmerged / 探测不到 → null
 *  （fail-open：守卫不拦正常路径，判据信 GitHub 真值不信本地 git）。
 *  excludeBuildId = 本 build——自身 PR 已合并属正常落地路，不误拦；无先前
 *  PR build 时列表为空、零出站（守卫在常规首 PR 流程上不花网络）。closed-
 *  unmerged 继续向更旧的 build 探（首 PR 关闭后更早一张已合并的形仍算已交付）。 */
export async function mergedPrElsewhere(
  deps: BuildDeps,
  todoId: string,
  excludeBuildId: string,
): Promise<{ prNumber: number; prUrl: string | null } | null> {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (todoRow === undefined) return null;
  const prior = deps.db
    .select()
    .from(build)
    .where(
      and(
        eq(build.todoId, todoId),
        ne(build.id, excludeBuildId),
        or(isNotNull(build.prUrl), isNotNull(build.prNumber)),
      ),
    )
    .orderBy(desc(build.createdAt))
    .all();
  for (const row of prior) {
    if (row.prNumber === null) continue;
    const state = await probePullState(
      deps,
      todoRow.teamId,
      todoRow.projectId,
      row.prNumber,
      MERGED_PR_GUARD_PROBE_TIMEOUT_MS,
    );
    if (state?.merged) return { prNumber: row.prNumber, prUrl: row.prUrl };
  }
  return null;
}

/** #1217 第二张 PR 守卫（合并面兜底）：本 build 自己开了 PR 且同 todo 已有更早的
 *  GitHub merged PR → 409 点名双 PR，拒收（同一 todo 两张 PR 先后落地 = 重复交付，
 *  卡 #25 实锤：首 PR #1202 合并后重跑轮又开 #1205 并被合并）。首 PR closed-unmerged
 *  不拦（返工重投正当）；探测不到不拦（fail-open——守卫主防线在 claim 面指令，此处
 *  是机器面外的第二道）。调用方放在权限闸、宣告行与任何合并动作之前：拒收即无痕。 */
async function assertNoMergedPrElsewhere(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
): Promise<void> {
  const priorMerged = await mergedPrElsewhere(deps, row.todoId, row.id);
  if (priorMerged !== null) {
    throw new HttpError(
      409,
      `本任务已有已合并的 PR #${priorMerged.prNumber}，本 build 又开了 PR #${prNumber}——疑似重复交付，拒绝发起合并（请人工复核后处理）`,
    );
  }
}

/** 确认回路（02 §4.2，r5 §4 实走）：POST /api/builds/{id}/steps
 * - {action:"confirm"} → confirm→building + 入队执行步（直执行时 building 中
 *   的再确认不适用，409 由流转表兜底）。
 * - {action:"revision", side:"plan", feedback, clientMessageId} → confirm→
 *   planning + 入队重规划步（同 conv continue session 语义归 M3）+ 时间线插
 *   用户驳回消息行（r5 §4）。#701：同一动作面在 review 关口 = 人肉打回
 *   （review→planning，边与 #330 blocking 自动回流共用）；门只开在
 *   confirm/review，其余相位 409 且不落任何行。
 * - {action:"review", agentId, focus?}（M7 #312 / r8 §3.1；材料随关口分叉
 *   = #511）→ phase 留 confirm/review + 入队审核步（kind='review'，不产可合并
 *   changes）+ 时间线插 REVIEW_ANNOUNCEMENT；phase 非法（todo/queued/
 *   planning/building/done/failed/closed）→ 409。材料：confirm 关口 = 方案
 *   全文（现行为）；review 关口 = 方案 + 本轮变更（readBuildChanges 同源）
 *   +（项目绑仓库时）只读检出说明。本函数 async 的唯一原因 = 变更面是 git
 *   读取，异常经 Promise 拒绝上浮，调用方必须 await。
 * - {action:"restart", feedback, clientMessageId} → 失败面带反馈重启（#320，
 *   r9 §3.3 实测：原站 failed 态发消息触发新一轮，消息随新轮入会话，非
 *   steer 409 语义）：#931 起 todo 已有产过 PR 的 build 时返工回该 build
 *   （同 conv 同分支同 PR，首步 freshSession 强制新会话——用户裁定「只复用
 *   分支、上下文真空」；原 PR 已合并/已关闭才另起新分支 + 判定 note 可见），
 *   无 PR build 保持现行新 build（withPlan 承接失败轮）+ 反馈行落新 conv +
 *   首步入队（instruction 携反馈，#720 起 daemon 以「任务文本 + 指令」组合
 *   串真投进会话；空白反馈 = 纯重启轮，无反馈行无 instruction）+ failed→queued
 *   漏斗。
 *   与 #308 停止钮的落态分界：停止 = 运行轮落上一完成 turn 的 gate（落态非
 *   failed）；restart 门只收 failed——两写面相位隔离，不共享入口。 */

export async function applyBuildStepAction(
  deps: BuildDeps,
  buildId: string,
  body:
    | { action: 'confirm' }
    | { action: 'revision'; side: 'plan'; feedback: string; clientMessageId: string }
    | { action: 'review'; agentId?: string; focus?: string }
    | { action: 'restart'; feedback: string; clientMessageId: string },
  /** 过闸宣告行的 actor 位（#902）：REST 面缺省 = 用户；chief 工具面传
   * Chief 绑定 Agent displayName；MCP 面 = key 属主（用户身份）。 */
  actor?: string,
): Promise<void> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  const actorName = actor ?? deps.user.displayName;

  if (body.action === 'restart') {
    // 相位门：仅 failed 可重启（confirm 走 revision、building/review 走
    // steer——漏斗边 confirm/review→queued 虽在，restart 不收，防写面互撞）。
    if (todoRecord.phase !== 'failed') {
      throw new HttpError(409, `restart 仅适用于 failed 相位（当前 ${todoRecord.phase}）`);
    }
    // 承接位 [设计]（原站 body 未录，r9 §5）：withPlan 随失败轮，assignment
    // 随 todo 现值（失败轮跑过 = 指派在位），机器面不继承失败轮——#1259 起
    // 步的去处 = 指派 Agent 的归属机，新一轮由归属机闸照常路由。
    const assignment = todoRecord.assignment ?? { plan: null, build: null };
    // #720 负例守卫：空白反馈（'  '——schema min(1) 拦不住空串以外的空白，
    // UI composer 的 text!=='' 同拦不住）不成发送：不落空白用户行、不注入
    // 「用户反馈：「」」空壳指令——纯重启轮（首步 prompt = null，daemon
    // #720 投递纯任务文本）。
    const feedbackText = body.feedback.trim() === '' ? null : body.feedback;
    // —— #931 返工目标判定：todo 已有产过 PR 的 build 时，返工回该 build 的
    // 分支/PR 继续（buildId ≡ conversationId ≡ 分支名，复用即原 PR 就地更新；
    // 用户裁定 2026-10-05「一 todo 至多一 open PR」）。目标 = 最新 PR build
    // （更旧的 PR 属被取代分支，存量收敛规则见 spec 23）。原 PR 已合并/已
    // 关闭时才允许另起新分支——显式且可见的判定（票面失败方式 3）。——
    const reworkTarget = latestPrBuild(deps.db, row.todoId);
    const prClosed: 'merged' | 'closed' | null =
      reworkTarget !== null ? await probeReworkTargetPr(deps, reworkTarget, todoRecord) : null;
    if (reworkTarget !== null && prClosed === null) {
      // —— 复用路：不建新 build——同 conversationId = 同分支 = 原 PR。——
      const now = nowMs();
      // 消息先于首步入队（transcript 排序 + machine wake 后置）：反馈行（用户
      // 话语）+ 轮界 note（system → web note 面：去向 + 被清空 errorMessage 的
      // 失败原因承接，原因不随轮界蒸发）。
      if (feedbackText !== null) {
        insertMessageRow(deps, reworkTarget.id, {
          id: newRecordId(),
          role: 'user',
          content: feedbackText,
          createdAt: now,
        });
      }
      insertMessageRow(deps, reworkTarget.id, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkReuseNote({
          prNumber: reworkTarget.prNumber,
          prUrl: reworkTarget.prUrl,
          failureReason: reworkTarget.errorMessage,
        }),
        createdAt: now,
      });
      // 文本单源 = shared buildRestartPrompt（#612/#720 同律）；freshSession =
      // 返工轮边界（用户裁定「只复用分支、上下文真空」：claim 强制 new
      // session，daemon 以「任务全文 + 指令」组合串开全新会话）。
      const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
      enqueueStep(
        deps,
        reworkTarget.id,
        reworkTarget.withPlan ? 'plan' : 'build',
        todoRecord.teamId,
        restartPrompt,
        true,
      );
      // build 行收尾：errorMessage 清空（原因已进 note）、prevPhase=failed
      // （本轮起点）。
      deps.db
        .update(build)
        .set({
          errorMessage: null,
          prevPhase: 'failed',
        })
        .where(eq(build.id, reworkTarget.id))
        .run();
      setTodoPhase(deps, todoRecord.id, 'queued', {
        assignment,
        latestBuildId: reworkTarget.id,
        lastRunAt: now,
      });
      const reusedRow = deps.db.select().from(build).where(eq(build.id, reworkTarget.id)).get();
      if (!reusedRow) throw new Error('build missing after update');
      publishBuild(deps, reusedRow);
      return;
    }
    // —— 新建路：无 PR build（现行行为，逐字节保持）或原 PR 已合并/已关闭
    // （prClosed 在位）——新 conversationId = 新分支。——
    const newId = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id: newId,
        todoId: todoRecord.id,
        withPlan: row.withPlan,
        prevPhase: todoRecord.phase,
        triggerSource: 'user',
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    // 消息先于首步入队：transcript 按 createdAt 排序（反馈行在运行行之上），
    // 且 machine wake（enqueueStep 内）发生在消息落库之后。
    if (feedbackText !== null) {
      insertMessageRow(deps, newId, {
        id: newRecordId(),
        role: 'user',
        content: feedbackText,
        createdAt,
      });
    }
    // #931 判定可见（票面失败方式 3 /验收 4）：原 PR 已合并/已关闭 → 新 conv
    // 落 system note 点名旧 PR 与新分支——用户能看出「为什么这次是新 PR」。
    if (prClosed !== null && reworkTarget !== null) {
      insertMessageRow(deps, newId, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkNewBranchNote({
          prNumber: reworkTarget.prNumber,
          prUrl: reworkTarget.prUrl,
          branch: conversationBranch(newId),
          outcome: prClosed,
        }),
        createdAt,
      });
    }
    // 文本单源 = shared buildRestartPrompt（#612：web transcript 过滤侧按
    // 同一模板识别本行，不渲染成用户气泡——feedback 原文已有独立 wire 行；
    // #720：该指令经 claim instruction 位 → daemon 组合串（任务文本 + 指令）
    // 进会话，超长反馈在单源截断）。
    const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
    enqueueStep(deps, newId, row.withPlan ? 'plan' : 'build', todoRecord.teamId, restartPrompt);
    setTodoPhase(deps, todoRecord.id, 'queued', {
      assignment,
      latestBuildId: newId,
      lastRunAt: createdAt,
    });
    const newRow = deps.db.select().from(build).where(eq(build.id, newId)).get();
    if (!newRow) throw new Error('build missing after insert');
    publishBuild(deps, newRow);
    return;
  }

  if (body.action === 'confirm') {
    // #1403 G9：确认只属于 confirm 关口。别的相位先拒，再落宣告行——否则审计里留下一行
    // 没发生的「通过了确认」：review 关口（review → building 不是边，setTodoPhase 会 409）；
    // 已在 building 的第二次确认（双击、chief 与人同时确认）与 queued 的直执行卡（queued →
    // building 是机器领取的边）则会多排一个执行步。
    if (todoRecord.phase !== 'confirm') {
      throw new HttpError(409, `确认仅适用于待确认（confirm）关口，当前相位 ${todoRecord.phase}`);
    }
    // #902 确认闸通过宣告行（MERGE/REVIEW 同族行形）：actor 位答「在场的
    // 是谁」——此前 confirm 闸被按过在库里零痕迹（#892 §6 建议 3）。
    insertGateAnnouncement(deps, buildId, CONFIRM_ANNOUNCEMENT, actorName);
    // #1250（ADR 0018 层 2）：拆卡父的 confirm = 拆解方案过闸——派发无阻塞
    // 子卡（直执行），父进 building 当伞；不是入队 build 步（父无自己的执行
    // 面，子卡们就是它的执行面）。
    if (childrenOfTodo(deps.db, todoRecord.id).length > 0) {
      dispatchSplitChildren(deps, todoRecord.id);
      setTodoPhase(deps, todoRecord.id, 'building');
      return;
    }
    setTodoPhase(deps, todoRecord.id, 'building');
    enqueueStep(deps, buildId, 'build', todoRecord.teamId);
    return;
  }
  if (body.action === 'review') {
    // #702（B-C17）：failed 相位先过恢复闸——build 腿已交付的 failed 任务可
    // 「只重跑审核」（恢复回 review 关口再发起，与 merge 出口共用同一条边）；
    // 未交付 → 409 点名原因（半完成 build 不给审核面）。恢复后重读投影：
    // 下方关口分叉与材料面按恢复后的 review 关口走。
    restoreFailedReview(deps, row);
    if (todoRecord.phase === 'failed') {
      const restored = getTodo(deps, row.todoId);
      if (restored) todoRecord = restored;
    }
    // AI 审核发起仅在 confirm/review 关口允许（r8 §3.1 显隐律）；其余相位一律
    // 409 拒绝（建设期/planning/building/failed/done/closed/queued/todo 都不
    // 该出现该钮，但接口层兜底——钮外误用也要稳定拒绝）。
    if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
      throw new HttpError(409, `AI 审核仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
    }
    // 审核步 prompt：meta header（kind+agentId+gate，claim 载荷据此取 Agent
    // ——step 表无 agentId 列）+ JSON 输出契约 + plan.md 全文 +（审核关口）
    // 本轮变更 + 用户 focus。meta 解析与组装单源 =
    // shared/review.buildReviewStepPrompt；completeStep 在 verdict 收尾时 emit
    // REVIEW_VERDICT_KIND 消息 + 若 blocking 触发自动修订回路
    // （apps/server/services/machines.ts agentForStep 同步解析该头取 Agent）。
    // phase 留 confirm/review（review 步是额外 agent 步，不推进主时序）。
    const plan = deps.db
      .select({ content: planTable.content })
      .from(planTable)
      .where(eq(planTable.buildId, buildId))
      .orderBy(asc(planTable.version))
      .all();
    const planText = plan.map((p) => p.content).join('\n\n---\n\n');
    // —— 关口分叉（#511，判据 = 既有相位值，不新增状态）——
    // confirm 关口 = 方案就绪尚未动工：事实还不存在，只审方案（现行为不变）。
    // review 关口 = 本轮已产出改动：材料 = 方案（对照基准）+ 变更（待审事实）
    // ——否则审核者只能对方案表态，而它的结论与人的结论被并列呈现，看起来
    // 像对同一件事的两次独立复核。
    const gate: ReviewGate = todoRecord.phase === 'review' ? 'review' : 'confirm';
    const projectRow = projectOfTodo(deps.db, todoRecord);
    // 有检出 = 项目绑了仓库（daemon 侧同判据 = claim 载荷 project.repo 非空；
    // 单源 = git.hasRepoBinding/projectRepoRef）。未绑 = 不写检出段，不谎称。
    const checkout = hasRepoBinding(projectRow);
    const changes =
      gate === 'review'
        ? deps.reposDir !== undefined
          ? (await readBuildChanges({ db: deps.db, reposDir: deps.reposDir }, buildId)).files
          : []
        : undefined;
    // 读变更的 await 窗里相位可能已被改（#1403 PR 对账会把 review 收成 done/
    // failed）：重读再判，不在已收尾的卡上入队审核步、不落宣告行。
    const after = getTodo(deps, row.todoId);
    if (after?.phase !== todoRecord.phase) {
      throw new HttpError(
        409,
        `读取变更期间任务相位已变为 ${after?.phase ?? '（任务已删除）'}，未发起 AI 审核`,
      );
    }
    // 时间线「发起了 AI 审核」行（r8 §3.1 实测：行形 = role user 纯文本，
    // 呈现层拼装时间/actor；REVIEW_ANNOUNCEMENT 双端单源）。
    insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, actorName);
    const promptArgs = {
      gate,
      planText,
      ...(changes !== undefined ? { changes } : {}),
      checkout,
    } as const;
    // #1250（ADR 0018 层 1）：agentId 缺省 = fan-out 三视角——三员 persona
    // 各入队一条 review 步（agentId 走各自步的 prompt meta header；focus =
    // 用户 focus + 视角文案拼接），三份 verdict 并行落会话；无 persona 时回落
    // assignment.review 槽单步（槽位管「默认谁审」）；两者皆缺 400 点名补法。
    // 携带 agentId = 既有单审核人路径，行为不变。
    if (body.agentId === undefined) {
      // const 别名：todoRecord 是 let（failed 恢复分支重读），闭包里 TS 不保
      // 留 let 的非空收窄——取 const 快照。
      const currentTodo = todoRecord;
      const fanout = REVIEW_FANOUT_ROLES.map((role) => ({
        row: deps.db
          .select({ id: agent.id })
          .from(agent)
          .where(and(eq(agent.teamId, currentTodo.teamId), eq(agent.persona, role)))
          .get(),
        focus: personaByRole(role).reviewFocus ?? '',
      })).filter((p): p is { row: { id: string }; focus: string } => p.row !== undefined);
      if (fanout.length > 0) {
        for (const perspective of fanout) {
          const focus =
            body.focus !== undefined && body.focus.trim() !== ''
              ? `${body.focus.trim()}\n\n本视角重点：${perspective.focus}`
              : `本视角重点：${perspective.focus}`;
          const prompt = buildReviewStepPrompt({
            agentId: perspective.row.id,
            ...promptArgs,
            focus,
          });
          enqueueStep(deps, buildId, 'review', todoRecord.teamId, prompt);
        }
        return;
      }
      const fallback = todoRecord.assignment?.review?.agentId ?? null;
      if (fallback === null) {
        throw new HttpError(
          400,
          '无可用审核人：团队未播种 persona（CodeReviewer/SecurityAuditor/TestEngineer）且任务的 assignment.review 槽为空。指派审核 Agent（assignment.review 槽）或在请求里携带 agentId。',
        );
      }
      const prompt = buildReviewStepPrompt({ agentId: fallback, ...promptArgs });
      enqueueStep(deps, buildId, 'review', todoRecord.teamId, prompt);
      return;
    }
    const reviewPrompt = buildReviewStepPrompt({
      agentId: body.agentId,
      ...promptArgs,
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
    });
    enqueueStep(deps, buildId, 'review', todoRecord.teamId, reviewPrompt);
    return;
  }
  // revision：确认关口驳回（confirm→planning，r5 §4）与审核关口人肉打回
  // （review→planning，#701 B-C12）共用本动作面。审核闸的「人看」半边此前
  // 只能点头：静息 review 态消息通道 409（无 claimed 步），打回必须走这里，
  // 不挂「活跃会话」前提。边与 #330 blocking 自动回流同一条——边表语义
  // 「不止自动 verdict 能触发」由本分支落地。
  // 门只开在两个关口：planning 在途时 setTodoPhase 同相位幂等会吞掉断言、
  // 再叠一个重复 plan 步（补话走 steer 面）；其余相位 409。门先于一切写面
  // ——非法打回不留 feedback 行（流转断言在 setTodoPhase 内，晚于插行）。
  if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
    throw new HttpError(409, `revision 仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
  }
  // 用户驳回消息行进 transcript（role user，r5 §3.6/§4 时间线呈现）。
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'user',
    content: body.feedback,
    createdAt: nowMs(),
  });
  setTodoPhase(deps, todoRecord.id, 'planning');
  // 重规划步（同 conv continue session，r5 §4）：feedback 注入续轮指令，v2 忠实
  // 执行反馈（宿主等价物——措辞由 LLM 侧组织，本层给事实与要求）。
  // 文本单源 = shared buildReplanPrompt / buildReviewRejectPrompt（#612：web
  // transcript 过滤侧同款识别）——两关口事实不同：审核关口改动已产出且在
  // 会话分支上，指令交代产物保留（不孤儿化，#701 失败方式 3）。
  const replanPrompt =
    todoRecord.phase === 'review'
      ? buildReviewRejectPrompt(body.feedback)
      : buildReplanPrompt(body.feedback);
  enqueueStep(deps, buildId, 'plan', todoRecord.teamId, replanPrompt);
}

/** failed→review 恢复闸（#702 / #519 B-C17）：build 步已真实交付（分支/PR 在）
 * 而审核步失败时，failed 相位不再锁死合并路——恢复到 review 关口，merge 与
 * 只重跑审核两出口共用本闸。条件进服务端判定（「build 步 done 且产物在」）：
 * build 腿未完成（执行步 failed/未跑）或 done 但零产物（无 checkpointCommit
 * 且无 PR）的 failed 任务不获得该出路（半完成 build 不许被误放行）。恢复 ≠
 * 审核通过：落 review 等人工决策，done 仍只能经合并落地——恢复后的合并 =
 * 人工接受未完成 AI 审核的交付物，责任在人（02 §4.2 回写）。
 * 调用方：requestMerge 的合并步那条路（REST /builds/{id}/merge + chief
 * merge_builds）与 applyBuildStepAction action:"review"（审核重跑）——两者均先经
 * 本闸再走既有流程，正常 review 相位不经过这里。经 GitHub API 合并（#1403 段 2b）
 * 只用判据半边 assertDeliveredBuild，等 GitHub 的结局再恢复。 */
function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow?.phase !== 'failed') return; // 非失败相位 = 无可恢复
  assertDeliveredBuild(deps, row);
  // 走漏斗（条件边在边表里，setTodoPhase 放行）：review 进入通知 + chief wake
  // 由漏斗照发——「改动就绪等你」对恢复态同样成立，不是静默改相。
  setTodoPhase(deps, todoRow.id, 'review');
}

/** 恢复闸的判据半边（不写）：本 build 的执行步已 done 且产物在，否则 409 点名原因。
 *  经 GitHub API 合并（#1403 段 2b）先判后合：GitHub 明确拒绝时 failed 卡原样不动。 */
function assertDeliveredBuild(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  // build 腿：本 build 的执行步（序贯取最新）已 done。
  const buildStep = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.id), eq(step.kind, 'build')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  const legDone = buildStep?.status === 'done';
  // 产物：执行步回传的 conv 分支 HEAD（checkpointCommit =「分支在」）或
  // PR（prUrl/prNumber =「PR 在」）任一在场。
  const artifactIn =
    (buildStep?.checkpointCommit ?? null) !== null || row.prUrl !== null || row.prNumber !== null;
  if (!legDone || !artifactIn) {
    const reason = !legDone ? '执行步未完成交付' : '执行步无交付产物（分支/PR 不在）';
    throw new HttpError(
      409,
      `failed 任务的审核关口恢复仅对本轮已交付的 build 开放（${reason}），请重新运行任务`,
    );
  }
}

/** 合并（02 §4.2/A6：merge = 202 delegated）。两条路：
 * - GitHub 形态、build 记着 PR（#1403 段 2b，设计 D / ADR 0021 D2）：server 经 GitHub
 *   REST 合并这张 PR（mergeThroughGithub），不派机器合并步。
 * - 其余（托管仓、本地仓、GitHub 形态没有 PR、githubRepo 不合法）：机器领合并步
 *   continue session 复用执行轮会话 → git merge --no-edit → phase=done，执行面归 M3。 */
export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  /** 宣告行 actor 位（#902）：REST 缺省 = 用户；chief merge_builds = Chief
   * 绑定 Agent；MCP = key 属主。权限闸拒否与 actor 无关（403 在行之前）。 */
  actor?: string,
): Promise<{ delegated: true }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  // #1487：同一 build 已有在途合并步（排队、等额度或已领走）= 409，不多排一个——
  // 两个合并步先后跑完会各落一次地、各推一次。放在最前：拒收不该先改相位或
  // 去探 GitHub。
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'merge'),
        inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
      ),
    )
    .get();
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或在跑，等它结束再发起');
  const pr = githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  // #702（B-C17）：failed 相位先过恢复闸（build 腿已交付 → 回 review 关口；
  // 未交付 → 409 点名原因）。之后的合并关口判定与正常 review 一致。
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    // biome-ignore lint/style/noNonNullAssertion: restoreFailedReview transitions phase in place, never deletes the row; second get() must match the first
    todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get()!;
  }
  // 合并关口 = review（「将改动合并到默认分支」确认弹层，r3 §3.6）。#1217 第二张 PR
  // 守卫只对 GitHub 形态有意义（探测读 GitHub），在 mergeThroughGithub 里。
  assertPhaseTransition(todoRow.phase, 'done');
  assertMergeTools(deps, todoRow);
  // 时间线「发起了合并」行（r3 §3.6 实测：`15:06 Xmon Dai 发起了合并`；
  // 行形 [设计]——role user 纯文本 = shared MERGE_ANNOUNCEMENT 单源，呈现层
  // 拼装时间/actor）。
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  enqueueStep(deps, buildId, 'merge', todoRow.teamId);
  return { delegated: true };
}

/** GitHub 形态、build 记着 PR：目标仓与 PR 号；否则 null。经 API 合并（requestMerge 的
 *  分流）、合并步收尾（不收这类卡）与 #1150 磨绿入口（执行步成停在 building）同一判据。
 *  githubRepo 不合法（#1466）、项目不与任务同队（#1497）同按不是 GitHub 形态。 */
function githubPrOf(
  deps: BuildDeps,
  todoRow: { projectId: string; teamId: string },
  prNumber: number | null,
): { repoRef: GithubRepoRef; prNumber: number } | null {
  if (prNumber === null) return null;
  // 项目须与任务同队（#1497 projectOfTodo）：他队项目按未绑处理，不拿他队的仓出站。
  const repoRef = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  return repoRef === null ? null : { repoRef, prNumber };
}

/** 权限闸（XMON-77）：合并步收尾 = git merge + conv 分支 push（三形态 repo
 * 的落地都以推送为前置——local ff 落地、hosted applyMergeLanding 读推送态、
 * github done 语义即已推），assignment.build 槽 Agent 必须同时持有两开关；
 * 缺 = 403 并点名缺失项（chief merge_builds 与 REST /builds/{id}/merge 两
 * 生产者同摄于此；经 GitHub API 合并同闸，web 合并弹层的禁用态读同一判据）。
 * build 槽未指派 = 无权限主体可判，不拦（未指派步不可领是既有语义）。 */
function assertMergeTools(deps: BuildDeps, todoRow: TodoRow): void {
  const buildAgentId = todoRow.assignment?.build?.agentId;
  if (!buildAgentId) return;
  const agentRow = deps.db.select().from(agent).where(eq(agent.id, buildAgentId)).get();
  if (!agentRow) return;
  const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentRow.tools.includes(t));
  if (missing.length > 0) {
    throw new HttpError(
      403,
      `Agent ${agentRow.displayName} 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），无法发起合并`,
    );
  }
}

// —— #1403 段 2b：经 GitHub API 合并（设计 D，2026-10-22 用户裁决）————————————————

/** 步的种类在中文文案里的叫法（经 API 合并的「还有步在跑」拒绝）。 */
const STEP_KIND_TEXT: Record<StepKind, string> = {
  plan: '规划',
  build: '执行',
  merge: '合并',
  chief: '编排',
  review: '审核',
  verify: '验证',
};

/** 正在经 GitHub API 合并的 build（进程内）：同一 build 第二次点合并 409；PR 对账把它
 *  当作在飞步，GitHub 应答之前不读不写（hasActiveStep）。 */
const mergingBuilds = new Set<string>();

/** 本 build 在飞的步的种类：已被领取的任意步，以及排队中或等额度的非审核类步；没有为
 *  null。没人领（排队中或等额度）的 verify / review 步不算（Verifier 的机器离线或额度
 *  耗尽时，卡不能因此永远停在 review；收尾时由 finishTodoDone 停掉）。在飞的步收尾时还会
 *  提交并推送，经 API 合并在它跑完之前不发（#1403 段 2b）。 */
function stepKindInFlight(deps: BuildDeps, buildId: string): StepKind | null {
  return (
    deps.db
      .select({ kind: step.kind })
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
      .get()?.kind ?? null
  );
}

/** PR 对账的在飞判据（#1403）：本 build 有在飞的步，或人点的合并正在经 GitHub API
 *  进行（结果由它落，对账不插手）。 */
export function hasActiveStep(deps: BuildDeps, buildId: string): boolean {
  return mergingBuilds.has(buildId) || stepKindInFlight(deps, buildId) !== null;
}

/** 本 build 最后推送的提交：最后收尾的那一步（审核步除外：它不提交）回报的
 *  checkpointCommit；没有为 null。最后推送 = 最后收尾，不是最后建的：上一轮建的 verify
 *  步（Verifier 离线或等额度）可以在下一轮的 build 步之后才跑。按步的收尾时刻排
 *  （finishedAt，#1403 段 3）；迁移之前收尾的行没有它，回落最后一次报到（心跳 → 领取 →
 *  入队，同 stepActivityAt）。两个用处：
 *  - 经 API 合并的 sha（mergeSteps true）：分支上 pacman 最后推送的提交，合并步把默认
 *    分支并进工作分支的提交也算（PR 的 head 就是它）。
 *  - PR 对账核对「合并包含本 build 的交付」（mergeSteps false）：合并步的提交不是交付；
 *    GitHub 形态有 PR 的 build 上它只会是升级前排下的遗留步，PR 在 GitHub 合并之后才推上
 *    去也不该挡收尾（#1403 段 2b）。 */
export function lastPushedCheckpoint(
  deps: BuildDeps,
  buildId: string,
  opts: { mergeSteps: boolean },
): string | null {
  return (
    deps.db
      .select({ commit: step.checkpointCommit })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          notInArray(step.kind, opts.mergeSteps ? ['review'] : ['review', 'merge']),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .orderBy(
        desc(
          sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
        ),
        desc(step.createdAt),
      )
      .get()?.commit ?? null
  );
}

/** 经 API 合并的关口闸（不写；每次 await 之后重判）。相位：review 放行；failed 且本轮
 *  已交付（#702 恢复闸的判据）放行、failed 为 true（GitHub 合并或无明确答复之后才恢复
 *  到 review，明确拒绝时卡原样不动）；到不了 done 的相位抛非法相位转移（与合并步那条路
 *  同一错误）；building 这类到得了 done 却不是合并关口的 409。相位之后两道：这次运行仍是
 *  任务的当前运行（重跑之后旧 build 的 PR 可能还开着，合了它就把当前运行的交付晾在一
 *  边）；本 build 没有在飞的步。 */
function apiMergeGate(deps: BuildDeps, row: BuildRow): { todoRow: TodoRow; failed: boolean } {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  const failed = todoRow.phase === 'failed';
  if (failed) {
    assertDeliveredBuild(deps, row);
  } else {
    assertPhaseTransition(todoRow.phase, 'done');
    if (todoRow.phase !== 'review') {
      throw new HttpError(409, `合并只在审核关口发起，当前相位 ${todoRow.phase}`);
    }
  }
  if (todoRow.latestBuildId !== null && todoRow.latestBuildId !== row.id) {
    throw new HttpError(
      409,
      `这次运行已不是任务的当前运行（任务重跑过），pacman 不经它合并 PR #${row.prNumber}`,
    );
  }
  const busy = stepKindInFlight(deps, row.id);
  if (busy !== null) {
    throw new HttpError(
      409,
      busy === 'review'
        ? '本任务还有一个审核步在跑：等审核结论出来再合并。'
        : `本任务还有一个${STEP_KIND_TEXT[busy]}步在排队或在跑，它收尾时还会推送提交：等它跑完再合并。`,
    );
  }
  return { todoRow, failed };
}

/** squash 提交正文的关票行（ADR 0021 D2）：任务来自本仓的 issue N（GitHub issue 导入或
 *  自建 issue）时为 `closes #N`；别的仓的 issue、编排来源、无来源、畸形引用 = null。 */
function closingLine(todoRow: TodoRow, repoRef: GithubRepoRef): string | null {
  if (todoRow.sourceKind !== 'github-issue' && todoRow.sourceKind !== 'github-issue-self') {
    return null;
  }
  const issue = todoRow.sourceRef === null ? null : parseGithubIssueSourceRef(todoRow.sourceRef);
  if (issue === null) return null;
  const sameRepo =
    issue.owner.toLowerCase() === repoRef.owner.toLowerCase() &&
    issue.repo.toLowerCase() === repoRef.repo.toLowerCase();
  return sameRepo ? `closes #${issue.issueNumber}` : null;
}

/** squash 提交标题里的关票形态（#1403 段 2b D41）：GitHub 的关票关键字（close / closes /
 *  closed / fix / fixes / fixed / resolve / resolves / resolved，大小写不敏感，可带冒号），
 *  后面紧跟一个带数字的记号（#N、GH-N、owner/repo#N、issue 链接都在内）。PR 标题由 PR 作者
 *  定（WRITE_AUTHOR_ASSOCIATIONS 含只读成员），带着这种形态进默认分支就会关掉任意 issue，
 *  绕过 closingLine 只关本仓来源 issue 的规则。故意宽：「Fix 404」这类误伤只丢掉 PR 标题。 */
const CLOSING_SHAPE = /(?<![a-z])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*\S*\d/i;

/** 没有 closes 行时 squash 提交的正文（D42）：总要传一个，不传 GitHub 就按仓库设置取 PR
 *  正文或各提交 message。 */
const PLAIN_MERGE_BODY = 'Merged by pacman.';

/** 「GitHub 没有明确答复」行里的原因。 */
function unclearReason(result: Extract<GithubMergeResult, { kind: 'unknown' }>): string {
  switch (result.reason) {
    case 'timeout':
      return '请求超时';
    case 'network':
      return '网络错误';
    case 'malformed':
      return `HTTP ${result.status}，应答读不出`;
    case 'status':
      return `HTTP ${result.status}`;
  }
}

/** 经 GitHub API 合并（#1403 段 2b）：先做完所有不写的检查（相位、#1217 守卫、权限闸、
 *  GitHub 连接、最后推送的提交、同一 build 没在合并），读 PR 核对（本 build 自己的、开着、
 *  进默认分支、head 就是最后推送的提交），相位再判一次，然后
 *  `PUT pulls/{n}/merge {sha, squash, "<PR 标题> (#n)", closes 行}`（标题带关票形态时用
 *  「Merge pull request #n」，没有 closes 行时正文是 pacman 自己的一行）。结局三分：
 *  - 合并了：宣告行 + 合并行，卡还在原关口就收尾（failed 先恢复到 review）；相位在请求
 *    期间被人改了只落行。
 *  - GitHub 明确拒绝：409 带 GitHub 的理由，不落行、不改相位（再点一次再发一次）。
 *  - 没有明确答复：宣告行 + 一行说明，failed 恢复到 review（对账只读 review 卡），202；
 *    PR 对账读到它合并就收尾（sha 绑了最后推送的提交，包含关系天然成立）。 */
async function mergeThroughGithub(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
  repoRef: GithubRepoRef,
  actor: string,
): Promise<{ delegated: true }> {
  apiMergeGate(deps, row);
  await assertNoMergedPrElsewhere(deps, row, prNumber);
  // 守卫探测的网络窗里相位可能已被改（对账收尾、人关卡）：重读再判。
  const gate = apiMergeGate(deps, row);
  assertMergeTools(deps, gate.todoRow);
  // 拒绝文案里「之后怎么收尾」。review 卡：PR 在 GitHub 上合并后由对账核对并收尾（PR 不是
  // 本 build 的、合进别的分支、漏了最后推送的提交时，对账只在时间线说明）。failed 卡：对账
  // 不读（只读 review 卡），看板上把它拖到已完成也走合并弹层回到这里；在 GitHub 上合并之后
  // 再点一次合并，下文把它恢复到 review 交给对账。
  const hint = gate.failed
    ? '在 GitHub 上合并后再点一次合并：pacman 把卡恢复到审核关口，由对账核对后收尾'
    : 'pacman 对账读到合并后核对并收尾（核对不上时在时间线说明，由人处理，例如完成时不勾合并）';
  const access = teamGithubToken(deps, gate.todoRow.teamId);
  if ('reason' in access) {
    if (access.reason === 'no-secret-box') {
      throw new HttpError(
        409,
        `PR #${prNumber} 要经 GitHub 合并，但 server 没有配置密钥（secret box），读不了团队的 GitHub 连接：请检查 server 的密钥配置。`,
      );
    }
    const reconnect = access.reason === 'token-unreadable';
    const connect = reconnect ? '重新连接 GitHub' : '连接 GitHub';
    // 没有可用连接时对账匿名读：私有仓库读不到。failed 卡在 GitHub 上合并之后也要经这里
    // 恢复，没有连接就到不了。
    const next = gate.failed
      ? `任务处于失败态：${connect} 后再点合并`
      : `请${connect} 后再点合并，或直接在 GitHub 上合并这张 PR（${hint}；私有仓库没有连接时对账读不到它）`;
    throw new HttpError(
      409,
      reconnect
        ? `PR #${prNumber} 要经 GitHub 合并，但团队的 GitHub 连接解不开（密钥换过或密文损坏）：${next}。`
        : `PR #${prNumber} 要经 GitHub 合并，但团队没有连接 GitHub：${next}。`,
    );
  }
  const token = access.token;
  // 同一 build 的合并请求不叠发：检查与登记之间没有 await。
  if (mergingBuilds.has(row.id)) {
    throw new HttpError(409, `PR #${prNumber} 的合并请求正在进行，等它返回后再试。`);
  }
  mergingBuilds.add(row.id);
  try {
    const fetchImpl = deps.githubFetch ?? fetch;
    const page = await githubPull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber);
    // 读 PR 的网络窗里相位可能已被改：重读再判，且仍是开头那个关口。
    const before = apiMergeGate(deps, row);
    if (before.todoRow.phase !== gate.todoRow.phase) {
      throw new HttpError(409, `读取 PR 期间任务相位已变为 ${before.todoRow.phase}，没有发起合并`);
    }
    const pull = page?.pull ?? null;
    const branch = conversationBranch(row.id);
    if (pull === null || !hasPullFields(pull) || pull.title === null || pull.headSha === null) {
      throw new HttpError(
        409,
        `读不到 PR #${prNumber} 在 GitHub 上的状态（网络、限流或 GitHub 连接失效），没有发起合并：稍后再试。`,
      );
    }
    if (pull.state === 'closed' && !pull.merged) {
      throw new HttpError(
        409,
        `PR #${prNumber} 在 GitHub 上已关闭且未合并，无法合并：重新打开它，或重新运行任务。`,
      );
    }
    // 本 build 自己的 PR（与 PR 对账同一判据）：fork 里同名分支开的 PR 不合。
    if (!isOwnPull(pull, branch)) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 不是本任务在 ${repoRef.owner}/${repoRef.repo} 的工作分支「${branch}」，pacman 不合并它：请在 GitHub 上核对这张 PR。`,
      );
    }
    // 作者要对仓库有写权限（与对账改记同一判据）：daemon 记的是工作分支上编号最大的开着的
    // PR，不看是谁开的；没有写权限的人从这个分支开的 PR，标题与正文由他定。
    if (!WRITE_AUTHOR_ASSOCIATIONS.has(pull.authorAssociation ?? '')) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的作者对仓库没有写权限（author_association ${githubText(pull.authorAssociation ?? '缺失')}），pacman 不经 API 合并它：请在 GitHub 上核对后合并（${hint}）。`,
      );
    }
    if (pull.baseRef !== pull.defaultBranch) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的目标分支「${githubText(pull.baseRef)}」不是默认分支「${githubText(pull.defaultBranch)}」，pacman 只把改动合进默认分支：请在 GitHub 上核对这张 PR。`,
      );
    }
    if (pull.merged) {
      if (!gate.failed) {
        throw new HttpError(409, `PR #${prNumber} 已在 GitHub 合并，没有再发起合并：${hint}。`);
      }
      // failed 卡（本轮已交付，apiMergeGate 判过；PR 是本 build 的、作者有写权限、合进默认
      // 分支，上文判过）：恢复到 review，对账读到合并后核对并收尾。
      setTodoPhase(deps, row.todoId, 'review');
      insertMessageRow(deps, row.id, {
        id: newRecordId(),
        role: 'system',
        content: `PR #${prNumber} 已在 GitHub 合并：任务回到审核关口，pacman 对账核对后收尾（核对不上时在时间线说明）。`,
        createdAt: nowMs(),
      });
      return { delegated: true };
    }
    const checkpoint = lastPushedCheckpoint(deps, row.id, { mergeSteps: true });
    if (checkpoint === null || !isFullSha(checkpoint)) {
      throw new HttpError(
        409,
        `本任务没有可核对的推送提交（执行步没回报有效的提交 SHA），pacman 不经 GitHub 合并 PR #${prNumber}：请在 GitHub 上核对后合并（${hint}），或重新运行任务。`,
      );
    }
    if (pull.headSha !== checkpoint) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 是 ${githubText(pull.headSha).slice(0, 7)}，不是本任务最后推送的提交 ${checkpoint.slice(0, 7)}：GitHub 可能还没同步刚推的提交（稍后再点），或分支上有了别的提交（有人推送，或点了 Update branch）。pacman 只合并它推送过的提交；请在 GitHub 上核对后合并（${hint}），或让任务再跑一轮。`,
      );
    }
    // 标题取 PR 标题（ADR 0021 D2），带关票形态时改用 pacman 自己的标题（D41）。
    const titled = `${pull.title} (#${prNumber})`;
    const result = await githubMergePull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber, {
      sha: checkpoint,
      // 只验 PR 标题本身：拼上「 (#n)」再验，以 fix / close / resolve 结尾的标题会经「(#n」
      // 误命中而丢掉标题（#1509 pr-gate 第 4 轮）。
      commitTitle: CLOSING_SHAPE.test(pull.title) ? `Merge pull request #${prNumber}` : titled,
      // 取读 PR 之后重读的任务行：读的网络窗里自建 issue 可能刚补上 sourceRef（D43）。
      commitMessage: closingLine(before.todoRow, repoRef) ?? PLAIN_MERGE_BODY,
    });
    if (result.kind === 'rate-limited') {
      // 限流的请求 GitHub 没有处理：合并确定没有发生，不落行、不恢复卡。等多久与进料读同一
      // 先后：retry-after 优先（二级限流常同时带主窗口更晚的 x-ratelimit-reset）。
      const { limit } = result;
      const when =
        limit.retryAfterSeconds !== null
          ? `，${limit.retryAfterSeconds} 秒后再试`
          : limit.resetAt !== null
            ? `，限流在 ${new Date(limit.resetAt).toISOString()} 解除`
            : '';
      throw new HttpError(
        409,
        `GitHub 限流，没有处理合并 PR #${prNumber} 的请求（HTTP ${limit.status}${when}）${result.message === '' ? '' : `：${githubText(result.message)}`}——稍后再点合并，或直接在那里合并（${hint}）`,
      );
    }
    if (result.kind === 'refused') {
      throw new HttpError(
        409,
        result.status === 401
          ? `GitHub 不认团队的 GitHub 连接（HTTP 401），PR #${prNumber} 没有合并：请重新连接 GitHub 后再点合并。`
          : `GitHub 拒绝合并 PR #${prNumber}（HTTP ${result.status}）${result.message === '' ? '' : `：${githubText(result.message)}`}——可在 GitHub 上处理后直接在那里合并（${hint}）`,
      );
    }
    // 合并了，或不知道合没合：请求已经发出，落宣告行。卡还在开头那个关口才动相位。
    const now = deps.db
      .select({ phase: todo.phase })
      .from(todo)
      .where(eq(todo.id, row.todoId))
      .get();
    const atGate = now?.phase === gate.todoRow.phase;
    if (atGate && gate.failed) setTodoPhase(deps, row.todoId, 'review');
    insertGateAnnouncement(deps, row.id, MERGE_ANNOUNCEMENT, actor);
    insertMessageRow(deps, row.id, {
      id: newRecordId(),
      role: 'system',
      content:
        result.kind === 'merged'
          ? `PR #${prNumber} 已由 pacman 经 GitHub 合并（squash，合并提交 ${githubText(result.sha).slice(0, 7)}）`
          : `已请 GitHub 合并 PR #${prNumber}，GitHub 没有明确答复（${unclearReason(result)}）。pacman 对账会读这张 PR：已合并就收尾；还开着就留在审核关口，可以再点合并。`,
      createdAt: nowMs(),
    });
    if (result.kind === 'merged' && atGate) finishTodoDone(deps, row.todoId, row.id);
    return { delegated: true };
  } finally {
    mergingBuilds.delete(row.id);
  }
}

/** plan 步未产 plan.md 的自动补写指令（#113 裁定候选1，02 §4.2「plan 即文件」
 * 交接物契约执行；四段落要求同驳回重规划指令族）。#703 起文本单源 =
 * shared buildPlanRewritePrompt（呈现层过滤侧按同一模板识别续轮指令行）。 */
const PLAN_REWRITE_PROMPT = buildPlanRewritePrompt();

/** AI 审核 blocking 自动修订 prompt（M7 #330，r8 §3.1 实测 62：「调用工具:
 * edit_plan」+ 调整摘要行）。与驳回重规划轮同形（plan 步 + continue session
 * 复用 + 服务端 prompt 注入反馈事实），措辞由 LLM 侧组织——本层给事实与要
 * 求。 */
const REVIEW_REVISE_PROMPT = `用户对方案提出审核反馈，结论含 blocking findings。审核结论：<{conclusion}>。\n\nBlocking findings（必须逐条修复）：\n{blockings}\n\n请忠实按反馈调整方案，输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），并在结尾一句话摘要本次调整了什么。`;

/** review→planning 修订回流边（M7 #330 phase 表已登边；#700 起独立成函数）：
 * 相位翻转 + 时间线摘要行 + 重规划步入队三件一体。note 与 revisePrompt 由
 * 调用方组装——blocking verdict 自动触发（上方）与人肉打回（#701 B-C12，
 * 「请求修改」语义）走同一条边，边不焊死在自动 verdict 触发上。 */
function enqueueReviewRevision(
  deps: BuildDeps,
  args: { buildId: string; todoId: string; teamId: string; note: string; revisePrompt: string },
): void {
  setTodoPhase(deps, args.todoId, 'planning');
  insertMessageRow(deps, args.buildId, {
    id: newRecordId(),
    role: 'system',
    content: args.note,
    createdAt: nowMs(),
  });
  enqueueStep(deps, args.buildId, 'plan', args.teamId, args.revisePrompt);
}

/** 步级失败落账（#703 提取共通漏斗）：step failed + build.errorMessage +
 * todo → failed（相位边合法时——planning/building/review 均有 failed 边）。
 * finishStep 的 failed 分支与 #703 产物闸共用；调用方各自负责 publishStepStatus
 * （事件面在 finishStep 收尾统一发）。 */
export function applyStepFailure(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  rawErrorMessage: string,
): void {
  const { db } = deps;
  // #1492：空原因会让卡片上的失败横幅（errorMessage 非空才渲染）整块消失。
  const errorMessage =
    rawErrorMessage.trim() === '' ? `${stepRow.kind} 步异常结束，未上报原因` : rawErrorMessage;
  db.update(step)
    .set({ status: 'failed', finishedAt: nowMs() })
    .where(eq(step.id, stepRow.id))
    .run();
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
  // #1492 build 步兜底报告：机器报失败、产物闸、失联收尾都经本漏斗，会话里
  // 落一条系统报告（失败原因 + 已知改动 + PR + 下一步），不只剩一行错误。
  if (stepRow.kind === 'build') {
    const changes = buildRow.changes;
    const files =
      changes == null
        ? undefined
        : (Array.isArray(changes) ? changes : changes.files).map((f) => f.path);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: buildFallbackReport({
        reason: errorMessage,
        ...(files !== undefined ? { files } : {}),
        pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      }),
      createdAt: nowMs(),
    });
  }
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow && canTransitionPhase(todoRow.phase, 'failed')) {
    setTodoPhase(deps, todoRow.id, 'failed');
  }
}

/** 步失败收尾三件套（#1104 起双消费者）：applyStepFailure（落账，step
 * failed + build.errorMessage + todo → failed）+ build doc 事件 + 会话流
 * step 事件。sweep 的无人认领收尾与 claim 面的无主步收尾（machines.ts
 * tryClaim）共用——「与机器报失败同一漏斗」若两处各写各的事件面，漂移即
 * 事件缺口，故收口单函数。机器报失败路径（finishStep 的 failed 分支）
 * 保持 #703 口径原形（只发 step 事件），非本族。 */
export function failStepWithEvents(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): void {
  applyStepFailure(deps, stepRow, reason);
  const failedBuild = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (failedBuild) publishBuild(deps, failedBuild);
  const failedStep = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (failedStep) {
    deps.convHub?.publishStep(stepRow.buildId, {
      id: failedStep.id,
      buildId: failedStep.buildId,
      kind: failedStep.kind,
      machineId: failedStep.machineId,
      createdAt: failedStep.createdAt,
      status: failedStep.status,
      checkpointCommit: failedStep.checkpointCommit,
      skillInjection: failedStep.skillInjection ?? null,
    });
  }
}

// —— #706 build 步失联扫尾 + #862 T1 跨机续跑释放（B-C7；#684 chief 扫尾的同型）——

export const BUILD_ABANDONED_STEP_MS = 120_000;

/** worker 步（plan/build/merge/review/verify）失联 sweep（scheduler tick 驱动）：
 * 失联 claimed 步**释放回 pending**供他机认领续跑（#862 T1 tracer）；无人
 * 认领的 pending 步挂起等机器（#1257：无人认领是 infra 事件，机器回来走
 * 既有 claim 循环自动续跑，「等机器」可见态由 todo waitingOn 派生承担，
 * 不进 failed）。判定只剩 claimed 面两支：
 * ② claimed 心跳停更超阈值且机器离线/失踪（daemon 步中途死亡）→ 释放；
 * ③ claimed 自领取后零心跳进展超阈值（B-C7 claim 移交竞态：server 标 claimed
 *    但机器侧零执行——claim 把 lastHeartbeatAt 置为 claimedAt，故「零进展」
 *    即 heartbeat 从未推进；机器在线也命中 = 「已证明病了」的派发未生效形，
 *    #1257 唯一保留的杀位）→ 释放。
 * 不动：心跳新鲜的 claimed 步（心跳年龄是活判据，不是墙）；pending 步一律
 * 不动（挂起等机器——含归属机离线/闸挡/楔住/未设的形态，机器回归、开
 * runtime、补设归属机后由 claim 循环自动续跑）；在线机器上曾有心跳后停更的
 * claimed 步（执行/推送通道部分存活的歧义态，等 presence 过期走 ②）。
 * chief 步不在本面（chief.ts 扫尾）。
 * #1445 / #1451 已关、已完成卡例外：closed / done 卡名下的 pending /
 * waiting_quota 步一律停掉（修复前的存量），失联 claimed 步停掉而不释放——释放
 * 回 pending 等于又能被领。
 * 释放语义：status → pending + machineId 清空（认领原子位复位，归属机回来
 * 经 claim 循环重领——#1259 起机器可见性由 agent 归属机闸单源判定）；claimedAt/
 * lastHeartbeatAt 保留作死亡时刻审计（重领即覆写）；createdAt 不动（FIFO
 * 序）；todo 相位不动（building + pending 步 = 合法排队）；build.errorMessage
 * 不写（非失败）；会话流 step 事件（pending 态）+ 团队 wake（他机 75s 长轮询
 * 不等满）。new-session 降级标记归 daemon 侧（续接失败回退即插 transcript
 * 注记）。
 * 幂等：只扫 pending/claimed，终态步天然跳过。 */
export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        inArray(todo.phase, ['closed', 'done']),
        inArray(step.status, ['pending', 'waiting_quota']),
      ),
    )
    .all();
  for (const { id } of exitedLeftovers) stopStepKeepPhase(deps, id);
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'merge', 'review', 'verify']),
        inArray(step.status, ['pending', 'claimed']),
      ),
    )
    .all();
  for (const row of candidates) {
    if (row.status === 'pending') continue; // #1257：挂起等机器，pending 面无失败
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (!buildRow) continue; // 孤儿步：无呈现面
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) continue;
    // claimed：claim 置位 heartbeat（machines claim 面），故 null/陈旧一律
    // 可判——有效心跳取三级回落（heartbeat → 领取时刻 → 入队时刻）。
    const effectiveBeat = stepActivityAt(row);
    if (now - effectiveBeat > BUILD_ABANDONED_STEP_MS) {
      const machineRow = row.machineId
        ? deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get()
        : undefined;
      const progressed =
        row.lastHeartbeatAt !== null && row.lastHeartbeatAt > (row.claimedAt ?? row.createdAt);
      if (machineRow === undefined || !machineRow.online || !progressed) {
        if (todoRow.phase === 'closed' || todoRow.phase === 'done') stopStepKeepPhase(deps, row.id);
        else releaseClaimedStep(deps, row, todoRow);
      }
    }
  }
}

/** 失联 claimed 步释放（#862 T1 跨机续跑的 server 半）：认领原子位复位，归属
 * 机回来（或他面任何可见机）经 claimCandidates 重领。调用方已取 todo 行，
 * 透传免重查。 */
function releaseClaimedStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): void {
  deps.db.update(step).set({ status: 'pending', machineId: null }).where(eq(step.id, row.id)).run();
  const released = deps.db.select().from(step).where(eq(step.id, row.id)).get();
  if (released) {
    deps.convHub?.publishStep(row.buildId, {
      id: released.id,
      buildId: released.buildId,
      kind: released.kind,
      machineId: released.machineId,
      createdAt: released.createdAt,
      status: released.status,
      checkpointCommit: released.checkpointCommit,
      skillInjection: released.skillInjection ?? null,
    });
  }
  // 他机 75s 长轮询不等满：释放即 wake，同队等待者立即重认领（machineHub 缺省
  // = M2a 编排测试形态，无机器面可唤醒）。
  deps.machineHub?.wake(todoRow.teamId);
}

/** #703 产物闸（B-C10/B-C11/B-C14）：两道闸各自有物可看，无物即无闸（spec 18
 * §3.1）——方案步没写出方案文档，进不了 confirm 闸；构建步零改动/假完成，进
 * 不了 review 闸。判定钉「本步该产什么」（plan 步 → 方案文档；build 步 →
 * 变更），非全局「空即拦」：review 步 hasChanges 恒 false（只读收尾，#511）
 * 不受闸 2 影响，hasChanges 缺省（老 daemon 版本墙）fail-open。
 * 真值源 = daemon 侧产物通道：plan 行（runner 收尾上传 plan.md 落库）与 done
 * 载荷 hasChanges（runner 侧 worktree git 判定 countAhead）——不读服务端
 * changes 投影（readBuildChanges 对非 hosted 项目恒空，读它把手动项目全拦死；
 * #704 地界）。首轮 plan 步缺产物不在此闸：#113 补写轮承担「重试一次」，闸只
 * 拦重试后的仍空。返回 null = 过闸。 */
function stepArtifactGate(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: { hasChanges?: boolean; workBranchDrift?: { expected: string; actual: string } },
  planContract: PlanContractCheck | null,
): string | null {
  if (stepRow.kind === 'plan') {
    const planRow = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (planRow !== undefined) {
      // #1492 结构闸：结构补写轮仍不合格 = 失败收尾（每轮规划最多补写一次）；
      // 非补写轮的不合格在 completeStep 落 done 后入队补写轮。
      if (
        planContract !== null &&
        !planContract.ok &&
        isPlanContractRewritePrompt(stepRow.prompt)
      ) {
        return `方案结构不合格：${planContract.problem}`;
      }
      return null;
    }
    // 本 build 首个 plan 步（无其它 plan 步行）→ 补写轮重试，非闸失败。判据
    // 不用 prompt===null：失败重启轮首步带 restart 指令（prompt 非 null）同样
    // 该享一次重试，否则重启即硬失败。
    const priorPlanStep = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, stepRow.buildId), eq(step.kind, 'plan'), ne(step.id, stepRow.id)))
      .get();
    if (priorPlanStep === undefined) return null;
    return '规划未产出方案';
  }
  if (stepRow.kind === 'build') {
    // #1277：HEAD 停在契约分支之外即硬失败，不论 hasChanges。#1195 只在
    // hasChanges=false 时点名，有提交的偏离被并集面放进 review。Multica
    // verifyDeliveryPoint 拒绝记录 off-branch 交付，留给人工。
    const drift = outcome.workBranchDrift;
    if (drift !== undefined) {
      if (outcome.hasChanges === false) {
        return `agent 偏离工作分支且步窗口内未见任何提交：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
      }
      return `agent 偏离工作分支交付，已拒绝自动收工：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
    }
    if (outcome.hasChanges === false) return '构建零改动';
  }
  return null;
}

/** 本 build 最新一版方案（version 最大）；没有方案 = undefined。 */
function latestPlanRow(
  deps: BuildDeps,
  buildId: string,
): { content: string; stepId: string | null } | undefined {
  return deps.db
    .select({ content: planTable.content, stepId: planTable.stepId })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(desc(planTable.version))
    .get();
}

/** #1492 plan 步的结构闸结论：只看本步自己上传的那一版（老 plan 行、没重新
 *  上传方案的重规划步不回溯）；结构补写轮例外——它没重新上传就按本 build
 *  最新一版判，旧版不合格方案不能借补写轮混进 confirm。null = 无可判的方案。 */
function planContractOfStep(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
): PlanContractCheck | null {
  const rewrite = isPlanContractRewritePrompt(stepRow.prompt);
  const latest = latestPlanRow(deps, stepRow.buildId);
  if (latest === undefined) return null;
  if (!rewrite && latest.stepId !== stepRow.id) return null;
  return checkPlanContract(latest.content);
}

/** 机器步完成后的 phase 推进（M3 claim/journal 面挂接点；M2a 供编排测试
 * 驱动状态机）：规划步成 → confirm（withPlan）/ building（直执行续跑）；
 * 执行步成 → review；合并步成 → done（02 §4.2 主时序）。M7 #330：审核步成
 * → emit REVIEW_VERDICT_KIND 消息 + 若 blocking → planning + enqueue 重规划
 * 步（自动修订回路，r8 §3.1）。#703 产物闸先于 done 落位——无物步按失败
 * 收尾，confirm/review 不可达。 */
export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: {
    hasChanges?: boolean;
    /** #1195/#1277 工作分支偏离（daemon 收尾检测）：build 步携带即硬失败。
     *  hasChanges=false 时原因说明步窗口内无提交；有提交时拒绝自动收工。
     *  两态都点名两分支。 */
    workBranchDrift?: { expected: string; actual: string };
    findings?: ReviewVerdict;
    findingsError?: string;
    /** verify 步 verdict（#1250）：daemon 从 agent 终轮 JSON 提取；两字段
     *  皆缺（旧 daemon）= 消息落「验证未返回结论」兜底。 */
    verifyVerdict?: VerifyVerdict;
    verifyVerdictError?: string;
  } = {},
): void {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    return;
  }
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    return;
  }
  // #1453 / #1247：停止信号在途时步先正常跑完。卡已被写离执行中、步属旧
  // build（重开重跑后迟到），或这次停止预定了落点——只落步：不走产物闸、不推
  // 相位、不补排、不落审核 / 验证结论。推相位在 closed / done 上是非法边（回报
  // 409，daemon journal 每次重启重报），在 todo 上会把卡推进 confirm。预定
  // done（stop-and-done）照落 done：用户要的是完成，步先跑完不改变这一点。
  const reserved = afterStopPhaseByBuild.get(buildRow.id);
  const staleBuild = todoRow.latestBuildId !== null && todoRow.latestBuildId !== buildRow.id;
  if (reserved !== undefined || staleBuild || hasLeftExecution(todoRow.phase)) {
    afterStopPhaseByBuild.delete(buildRow.id);
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    if (reserved !== undefined && reserved !== 'keep') landReservedPhase(deps, todoRow, reserved);
    return;
  }
  // 产物闸（#703）：失败收尾不落 done（完成判据 = 契约产物存在，不是会话
  // 结束——B-C10 空方案 / B-C11 零改动 / B-C14 假完成同病族）。
  // #1492 结构闸结论只算一次：产物闸与 plan 腿的补写判定共用。
  const planContract = stepRow.kind === 'plan' ? planContractOfStep(deps, stepRow) : null;
  const gateFailure = stepArtifactGate(deps, stepRow, outcome, planContract);
  if (gateFailure !== null) {
    // #1277：有提交的偏离拒绝记录。finishStep 在闸前已把 daemon 上报的 PR
    // 写入 build 行；硬失败不保留这次回填。无提交偏离（hasChanges=false）
    // 的既有失败文案与回填面不动。
    const refuseDriftRecord =
      stepRow.kind === 'build' &&
      outcome.workBranchDrift !== undefined &&
      outcome.hasChanges !== false;
    if (refuseDriftRecord) {
      deps.db
        .update(build)
        .set({ prUrl: null, prNumber: null })
        .where(eq(build.id, stepRow.buildId))
        .run();
    }
    applyStepFailure(deps, stepRow, gateFailure);
    if (refuseDriftRecord) {
      const cleared = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
      if (cleared) publishBuild(deps, cleared);
    }
    return;
  }
  deps.db
    .update(step)
    .set({ status: 'done', finishedAt: nowMs() })
    .where(eq(step.id, stepId))
    .run();

  if (stepRow.kind === 'plan') {
    // 交接物校验（#113：05 §5 实跑发现规划轮可跳过写 plan.md 直接交付，build 轮
    // 仅剩 confirm 关口措辞而拿不到任务内容）：本 build 首个规划步成功但未产
    // plan.md → 不算成——留 planning + 自动补写一轮（闸只拦重试后的仍空，
    // B-C10「两轮全空仍进 confirm」由 #703 闸堵死）。
    const planDoc = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (!planDoc) {
      enqueueStep(deps, stepRow.buildId, 'plan', todoRow.teamId, PLAN_REWRITE_PROMPT);
      return;
    }
    // #1492 结构闸：本步交的方案 Verification 不合格 → 留 planning + 结构补写
    // 一轮（问题点名进指令）。补写轮自身不合格已在产物闸失败收尾，到不了这里。
    if (planContract !== null && !planContract.ok) {
      enqueueStep(
        deps,
        stepRow.buildId,
        'plan',
        todoRow.teamId,
        buildPlanContractRewritePrompt(planContract.problem),
      );
      return;
    }
    // plan 卡就绪 → confirm（02 §4.2：phase=confirm 等人工）；hasPlan 置位
    // （闸 1 在位 = 过闸必有产物；plan chip 数据源）。hasPlan 走漏斗 extra
    // 单次写+发布（XMON-59：直写漏斗外曾无 v 无发布——漏斗同相位幂等化后，
    // 重放轮 done 直写还会被 no-op 吞掉伴随位，extra 是唯一「写+发」原子位）。
    setTodoPhase(deps, todoRow.id, 'confirm', { hasPlan: true });
    return;
  }
  if (stepRow.kind === 'build') {
    // #1150 CI 磨绿环：github 项目 PR 交付（prNumber 在——daemon github 形态
    // 步收尾回填）的执行步成 → 停在 building（CI 未判绿前不进人工闸；红 = 轮询器
    // 追加修复步续磨，绿 = 轮询器推进 review，services/ci-loop.ts）。磨绿面 =
    // github 项目的 PR checks（轮询器同判据）：hosted/local（无 GitHub checks 可磨）
    // 与 prNumber 缺位的存量形（仅 prUrl，#931 不猜号同律）→ 既有直进 review
    // 行为逐字节不变。githubRepo 存量值不合法（#1466）同按无 GitHub 仓处理：
    // 轮询器对它不出站，停在 building 就再没有出口。
    const deliveredGithubPr = githubPrOf(deps, todoRow, buildRow.prNumber) !== null;
    if (!deliveredGithubPr) {
      setTodoPhase(deps, todoRow.id, 'review', {
        hasChanges: outcome.hasChanges ?? true,
      });
      // #1250（ADR 0018 层 1）：review 关口抵达 → Verifier 入队（槽空零动作，
      // 幂等见函数注）。
      maybeEnqueueVerifyStep(deps, todoRow, stepRow.buildId);
      return;
    }
    // 相位已被推进到 failed（sweep 失联收尾先落、机器复活迟到 done 的竞态窗；
    // closed / done / todo 已在函数头 #1453 闸收口）→ 不回拽不抛：迟到回报照常收（步 done、PR 在 build 行），
    // 人从当前相位接手——与 #702 恢复闸哲学一致（恢复是显式人工闸，不是迟到
    // 回报的副作用）。正常路相位恒 building（claim 前置置位），走同相位幂等。
    if (todoRow.phase === 'building' || canTransitionPhase(todoRow.phase, 'building')) {
      setTodoPhase(deps, todoRow.id, 'building', {
        hasChanges: outcome.hasChanges ?? true,
      });
    }
    return;
  }
  if (stepRow.kind === 'review') {
    // AI 审核步完成（M7 #330，r8 §3.1 真 findings 上线）：emit REVIEW_VERDICT_KIND
    // 消息行（conclusion + 编号 findings，server zod 校验已固）+ 若 blocking →
    // 落 planning + 入队重规划步（REVIEW_REVISE_PROMPT 注入审核事实）回到
    // 待确认。审核不计入用户变化（hasChanges 恒 false）：审核关口虽开只读检出
    // （#511），但 daemon 侧不采集其改动、收尾还会 rewind 回步起点。
    // verdict 兜底两态（#700 B-C13）：daemon 报提取失败（findingsError 携带
    // 原因）= conclusion「判定提取失败」+ extractionError 原因随消息上浮
    // （web 审核面可分辨「提取器没取出来」）；两字段皆缺（旧 daemon 无信号）
    // = 保留「审核未返回结论」。两态均无 blocking 可判，不触发修订——但不再
    // 静默吞错。fail 兜底仍可独立走：findings 缺位 + status=failed = finishStep
    // 走 failed 分支不进本函数。
    const verdict: ReviewVerdict = outcome.findings ?? {
      conclusion: outcome.findingsError !== undefined ? '判定提取失败' : '审核未返回结论',
      findings: [],
    };
    deps.db
      .update(todo)
      .set({ hasChanges: false, v: todoRow.v + 1 })
      .where(eq(todo.id, todoRow.id))
      .run();
    const updatedTodo = getTodo(deps, todoRow.id);
    if (updatedTodo) deps.hub.publishTodoDoc(updatedTodo.teamId, updatedTodo);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: REVIEW_VERDICT_KIND,
        verdict,
        ...(outcome.findingsError !== undefined ? { extractionError: outcome.findingsError } : {}),
      }),
      createdAt: nowMs(),
    });
    if (hasBlockingFinding(verdict)) {
      // #1250 fan-out 去重闸：三视角并行报告的 blocking 各自命中时，同 build
      // 只入队一条修订步（pending/claimed 的 plan 步在位 = 已有一条——三份
      // blocking 指向同一批问题，重复入队 = 三个重规划轮叠跑）。单审核人
      // 路径同样受益（两次审核两份 blocking 也只该修一轮）。
      const revisionInFlight = deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, stepRow.buildId),
            eq(step.kind, 'plan'),
            inArray(step.status, ['pending', 'claimed']),
          ),
        )
        .get();
      if (revisionInFlight === undefined) {
        const blockings = verdict.findings
          .filter((f) => f.severity === 'blocking')
          .map(
            (f) =>
              `- #${f.id} ${f.summary}${
                f.file !== undefined
                  ? ` (${f.file}${f.line !== undefined ? `:${f.line}` : ''})`
                  : ''
              }`,
          )
          .join('\n');
        const revisePrompt = REVIEW_REVISE_PROMPT.replace(
          '<{conclusion}>',
          verdict.conclusion,
        ).replace('{blockings}', blockings);
        // AI 审核自动修订回路的「调整摘要行」（M7 #330，r8 §3.1 62）：chip →
        // 规划中自动走 phase 字段；该行 = 时间线 dim note 告诉用户「为什么又
        // 来一个 plan 步」。
        enqueueReviewRevision(deps, {
          buildId: stepRow.buildId,
          todoId: todoRow.id,
          teamId: todoRow.teamId,
          note: `AI 审核检测到 ${blockings.split('\n').length} 处 blocking 风险，已自动入队重规划步`,
          revisePrompt,
        });
      }
    }
    return;
  }
  if (stepRow.kind === 'verify') {
    // 验证步完成（#1250 / ADR 0018 层 1）：emit VERIFY_VERDICT_KIND 消息行
    //（passed + conclusion + evidence 条目，web 时间线渲染 pass/fail 与证据
    // 清单）；额外 agent 步不推进主时序——phase 留 review 关口，人工合并闸
    // 读 verdict 决策。verdict 兜底两态与 review 同律：提取失败（verifyVerdict
    // Error）=「判定提取失败」+ 原因上浮；两字段皆缺（旧 daemon）=「验证未
    // 返回结论」；passed=false 是有效结论不是本步失败（提取面不会把它折成
    // error）。
    // #1492 清单对账：方案有 Verification 清单时，缺证据的项点名、passed 置 false。
    const latestPlan = latestPlanRow(deps, buildRow.id);
    const verdict: VerifyVerdict =
      outcome.verifyVerdict !== undefined
        ? reconcileVerifyVerdict(
            outcome.verifyVerdict,
            planVerificationItems(latestPlan?.content ?? ''),
          )
        : {
            passed: false,
            conclusion:
              outcome.verifyVerdictError !== undefined ? '判定提取失败' : '验证未返回结论',
            evidence: [],
          };
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: VERIFY_VERDICT_KIND,
        verdict,
        ...(outcome.verifyVerdictError !== undefined
          ? { extractionError: outcome.verifyVerdictError }
          : {}),
      }),
      createdAt: nowMs(),
    });
    return;
  }
  // #1403 段 2b：GitHub 形态、build 记着 PR 的任务以 PR 在 GitHub 上合并为准（人点合并
  // = server 经 GitHub API 合并，不再派合并步）。这里完成的合并步是升级前排下的，或
  // build 在合并步回报时才记上 PR：步跑完不等于 PR 合并了——不收尾，落一行；PR 合并后
  // 由对账收尾（本轮没有完成行，对账照常收）。
  const pr = githubPrOf(deps, todoRow, buildRow.prNumber);
  if (pr !== null) {
    // 到不了 done 的相位照旧拒（与 finishTodoDone 同一判据，#931 返工复用同一 build 时
    // 旧合并步迟到）：不落行。
    assertPhaseTransition(todoRow.phase, 'done');
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: `合并步跑完了；本任务以 PR #${pr.prNumber} 在 GitHub 上合并为准，pacman 对账读到它合并后收尾。它若还开着：在审核关口点「合并」由 pacman 经 GitHub 合并，或直接在 GitHub 上合并。`,
      createdAt: nowMs(),
    });
    return;
  }
  // merge 步成 → done + 🎉（时间线「发起了合并」+ 结果行 + `🎉 任务已完成`，
  // r3 §3.6；celebration 行 [设计] = role system 纯文本）。
  finishTodoDone(deps, todoRow.id, buildRow.id);
}

/** done 收尾漏斗写的完成行（#1403 PR 对账据它判断本轮是否已收过尾）。 */
export const DONE_ROW = '🎉 任务已完成';

/** 本 build 这一轮的起点：最近一个 build / plan 步的创建时刻（#931 返工复用
 * 同一个 build 时，新一轮从新的执行步算起）；没有这类步为 0。 */
export function roundStart(deps: BuildDeps, buildId: string): number {
  return (
    deps.db
      .select({ at: step.createdAt })
      .from(step)
      .where(and(eq(step.buildId, buildId), inArray(step.kind, ['build', 'plan'])))
      .orderBy(desc(step.createdAt))
      .get()?.at ?? 0
  );
}

/** 本 build 的会话里是否有这一行（按值查一条；since = 只看此刻之后落的）。 */
export function hasMessageRow(
  deps: BuildDeps,
  buildId: string,
  role: 'system' | 'user',
  content: string,
  since = 0,
): boolean {
  return (
    deps.db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, role),
          eq(message.content, content),
          gte(message.createdAt, since),
        ),
      )
      .get() !== undefined
  );
}

/** done 收尾漏斗（merge 步成与 #1403 PR 对账两个落点共用）：停掉没人领的
 * verify / review 步、相位 → done、完成行、拆卡波次推进。两个落点都在卡还没写离
 * 执行中时才进来（completeStep 对已关闭 / 已完成的卡只记步，#1453；对账先核对卡
 * 仍在 review）。对账在本轮已有完成行时不进这里（ci-loop 的本轮已报告判据），两个
 * 落点不会叠两行。 */
export function finishTodoDone(deps: BuildDeps, todoId: string, buildId: string): void {
  // 到不了 done（已关闭、已是 done）就先抛错，什么都不动（setTodoPhase 同一判据）。
  const current = deps.db
    .select({ phase: todo.phase })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get()?.phase;
  if (current !== undefined) assertPhaseTransition(current, 'done');
  // 卡已收尾：没人领的 verify / review 步之后不再在它上面跑（合并步与对账同一处）。
  // 先停步再落相位：done 文档发出时不再带着这些步的等额度投影。
  stopUnclaimedGateSteps(deps, buildId);
  setTodoPhase(deps, todoId, 'done');
  // 完成行每次收尾都落：对账在本轮已有完成行时不收尾（ci-loop 的本轮已报告
  // 判据）；人把卡拖回 review 后同一轮里第二个合并步完成，再落一行（卡还是 done
  // 时合并步的回报只记步，走不到这里）。
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content: DONE_ROW,
    createdAt: nowMs(),
  });
  // #1250（ADR 0018 层 2）：done 落地即查拆卡波次——本卡是子项时推进其父的
  // 下一波（父自动收口在 setTodoPhase 的 settleSplitOnDone 半边，Todos 层）。
  advanceSplitWaves(deps, todoId);
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
