// build 服务面（02 §4.2/A6 锁定语义）：
// - 实体等式：一次运行 = 一个 build = 一个 conversation；buildId ≡ conversationId
//   （UUIDv7，r3 §3.0）。
// - step 队列 server 持有、机器 claim：POST builds → 入队规划步（withPlan）或
//   执行步（直执行）；确认 → 入队执行步；驳回 → 入队重规划步（同 conv
//   continue session，执行在 M3）；merge → 202 delegated + 入队合并步。
// - 失败仅人工重跑（r3 §3.7）：重跑 = 新 POST builds（新 conv/新 build）。
// 机器侧执行（claim/心跳/phase 推进 planning→confirm→…）归 M3；本层只持有
// 队列与人工触发的 phase 流转。

import type {
  Assignment,
  BuildRecord,
  Phase,
  ReviewGate,
  ReviewVerdict,
  SecretBox,
  StepJournalRow,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@pacman/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
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
  conversationBranch,
  hasBlockingFinding,
  MERGE_ANNOUNCEMENT,
  parseGithubIssueSourceRef,
  personaByRole,
  REVIEW_ANNOUNCEMENT,
  REVIEW_FANOUT_ROLES,
  REVIEW_VERDICT_KIND,
  STOP_MESSAGE,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
} from '@pacman/shared';
import { and, asc, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  machine,
  plan as planTable,
  project,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type FetchLike, githubPullState } from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { hasRepoBinding, readBuildChanges } from './git.js';
import { openGithubToken } from './github-connection.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import { stepQueueProjector } from './step-queue.js';
import { childrenOfTodo, getTodo, setTodoPhase, splitBlockersSatisfied } from './todos.js';
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

export function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    todoId: row.todoId,
    withPlan: row.withPlan,
    prevPhase: row.prevPhase ?? null,
    triggerSource: row.triggerSource,
    pinnedMachineId: row.pinnedMachineId,
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

/** 停止写面（M7 #308，r9 §3.3 停止钮 / 08 册附录 A composer 停止钮行）：
 * POST /api/builds/{id}/stop body {discard}——中断当前活动步。
 * - claimed 步 = 机器信号面（stop_pending 单槽 upsert + machine stream stop
 *   事件 → GET /api/machine/stop 拉取-确认 → daemon live.stop()，#278 steer
 *   同律）→ {delegated:true} 202；中断在途，done(stopped) 回报才落账。
 * - pending 步 = 无机器可通知，server 侧即时取消 → {delegated:false} 200。
 * 无活动步 = 409 不静默（steer 门同律）。 */
export function requestStop(
  deps: BuildDeps,
  buildId: string,
  body: { discard: boolean },
): { delegated: boolean } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  // 活动步 = pending/claimed（步序贯，取最新一条；orderBy 显式钉死语义，
  // 不依赖隐式 rowid 序）。
  const active = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed'])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    throw new HttpError(409, 'no active step on this build (stop 只对运行中的任务生效)');
  }
  if (active.status === 'pending') {
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
  db.update(step).set({ status: 'stopped' }).where(eq(step.id, stepId)).run();
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) {
    deps.convHub?.publishStep(stepRow.buildId, {
      id: stoppedRow.id,
      buildId: stoppedRow.buildId,
      kind: stoppedRow.kind,
      machineId: stoppedRow.machineId,
      createdAt: stoppedRow.createdAt,
      status: stoppedRow.status,
      checkpointCommit: stoppedRow.checkpointCommit,
      skillInjection: stoppedRow.skillInjection ?? null,
    });
  }
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
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
    .where(and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed'])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) return 'released';
    releaseZombieQueued(deps, buildRow, todoRow);
    return 'released';
  }
  if (active.status === 'pending') {
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
export function sweepZombieQueuedTodos(deps: BuildDeps, now: number = nowMs()): number {
  const rows = deps.db.select().from(todo).where(eq(todo.phase, 'queued')).all();
  let released = 0;
  for (const todoRow of rows) {
    if (todoRow.latestBuildId === null) continue; // 无 build 的 queued 不属本面
    const buildRow = deps.db.select().from(build).where(eq(build.id, todoRow.latestBuildId)).get();
    if (!buildRow) continue;
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildRow.id), inArray(step.status, ['pending', 'claimed'])))
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
            pinnedMachineId: buildRow.pinnedMachineId,
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
    /** 钉选机器（#682 优先级：调用方显式值 > todo.machineId > null 自动）。
     * schedule.machineId 透传（null = 该 schedule 未钉 → 回落 todo 值）；
     * chief run_builds 显式 machineId 覆盖；REST 人工启动不传 = todo 值。 */
    pinnedMachineId?: string | null;
  },
): BuildRecord[] {
  const triggerSource = input.triggerSource ?? 'user';
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord || todoRecord.projectId !== input.projectId) {
      throw new NotFoundError(`todo ${todoId}`);
    }
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
        // #682 缺省回落 todo.machineId（任务级默认机器）：null（未钉/清回
        // 自动）与 undefined（调用方无意见）都落到 todo 值；显式钉 > todo > 自动。
        pinnedMachineId: input.pinnedMachineId ?? todoRecord.machineId ?? null,
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
): void {
  const verifyAgentId = todoRow.assignment?.verify?.agentId;
  if (verifyAgentId == null) return;
  const existing = deps.db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'verify')))
    .get();
  if (existing !== undefined) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return;
  // 票号段（#1250 票面：docs/verify/<票号>/）：github 关联任务 = issue 号
  //（sourceRef 单源反解）；无关联 = seqNum（本地仓的同一约定位）。
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const ticketRef = String(linked?.issueNumber ?? todoRow.seqNum);
  const planRow = deps.db
    .select({ content: planTable.content })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(desc(planTable.version))
    .get();
  const prompt = buildVerifyStepPrompt({
    ticketRef,
    taskText: buildTaskPromptText(todoRow.title, todoRow.spec),
    planText: planRow?.content ?? '',
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
  const projRow = deps.db.select().from(project).where(eq(project.id, projectId)).get();
  if (projRow?.repoKind !== 'github' || projRow.githubRepo === null) return null;
  const slash = projRow.githubRepo.indexOf('/');
  const owner = projRow.githubRepo.slice(0, slash);
  const repo = projRow.githubRepo.slice(slash + 1);
  // token 阶梯：github_connection（已连接）→ 匿名（公开仓可达）。密文损坏/
  // box 缺席按未连接处理（探测是辅助面，不把主请求 500 掉）。
  let token: string | null = null;
  if (deps.box) {
    try {
      token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
    } catch {
      token = null;
    }
  }
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
    // 随 todo 现值（失败轮跑过 = 指派在位），机器不继承失败轮的 pin（schedule
    // 钉的旧值不带入），回落 #682 的任务级 todo.machineId（任务默认机器是新
    // 轮的合理起点）。
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
      // build 行收尾：errorMessage 清空（原因已进 note）、prevPhase=failed（本
      // 轮起点）、pin 回落 todo 值（#682 缺省链——失败轮的 pin 不继承，钉选
      // 语义与新 build 路一致）。
      deps.db
        .update(build)
        .set({
          errorMessage: null,
          prevPhase: 'failed',
          pinnedMachineId: todoRecord.machineId ?? null,
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
        pinnedMachineId: todoRecord.machineId,
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
    // 时间线「发起了 AI 审核」行（r8 §3.1 实测：行形 = role user 纯文本，
    // 呈现层拼装时间/actor；REVIEW_ANNOUNCEMENT 双端单源）。
    insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, actorName);
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
    const projectRow = deps.db
      .select()
      .from(project)
      .where(eq(project.id, todoRecord.projectId))
      .get();
    // 有检出 = 项目绑了仓库（daemon 侧同判据 = claim 载荷 project.repo 非空；
    // 单源 = git.hasRepoBinding/projectRepoRef）。未绑 = 不写检出段，不谎称。
    const checkout = hasRepoBinding(projectRow);
    const changes =
      gate === 'review'
        ? deps.reposDir !== undefined
          ? (await readBuildChanges({ db: deps.db, reposDir: deps.reposDir }, buildId)).files
          : []
        : undefined;
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
 * 审核通过：落 review 等人工决策，done 仍只能经合并步落地——恢复后的合并 =
 * 人工接受未完成 AI 审核的交付物，责任在人（02 §4.2 回写）。
 * 调用方：requestMerge（REST /builds/{id}/merge + chief merge_builds）与
 * applyBuildStepAction action:"review"（审核重跑）——两者均先经本闸再走
 * 既有流程，正常 review 相位不经过这里。 */
function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  const todoRow = db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow || todoRow.phase !== 'failed') return; // 非失败相位 = 无可恢复
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
  // 走漏斗（条件边在边表里，setTodoPhase 放行）：review 进入通知 + chief wake
  // 由漏斗照发——「改动就绪等你」对恢复态同样成立，不是静默改相。
  setTodoPhase(deps, todoRow.id, 'review');
}

/** 合并（02 §4.2/A6：merge = 202 delegated 机器执行；机器领合并步 continue
 * session 复用执行轮会话 → git merge --no-edit → phase=done，执行面归 M3）。 */
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
  // #702（B-C17）：failed 相位先过恢复闸（build 腿已交付 → 回 review 关口；
  // 未交付 → 409 点名原因）。之后的合并关口判定与正常 review 一致。
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get()!;
  }
  // 合并关口 = review（「将改动合并到默认分支」确认弹层，r3 §3.6）。
  assertPhaseTransition(todoRow.phase, 'done');
  // #1217 第二张 PR 守卫（合并面兜底）：本 build 自己开了 PR 且同 todo 已有
  // 更早的 GitHub merged PR → 409 点名双 PR，拒收（同一 todo 两张 PR 先后落地
  // = 重复交付，卡 #25 实锤：首 PR #1202 合并后重跑轮又开 #1205 并被合并）。
  // 本 build 无自身 PR 不拦（合并步本身是合法路径）；首 PR closed-unmerged 不
  // 拦（返工重投正当）；探测不到不拦（fail-open——守卫主防线在 claim 面指令，
  // 此处是机器面外的第二道）。放在权限闸/宣告行/入队之前：拒收即无痕。
  if (row.prNumber !== null) {
    const priorMerged = await mergedPrElsewhere(deps, row.todoId, row.id);
    if (priorMerged !== null) {
      throw new HttpError(
        409,
        `本任务已有已合并的 PR #${priorMerged.prNumber}，本 build 又开了 PR #${row.prNumber}——疑似重复交付，拒绝发起合并（请人工复核后处理）`,
      );
    }
  }
  // 权限闸（XMON-77）：合并步收尾 = git merge + conv 分支 push（三形态 repo
  // 的落地都以推送为前置——local ff 落地、hosted applyMergeLanding 读推送态、
  // github done 语义即已推），assignment.build 槽 Agent 必须同时持有两开关；
  // 缺 = 403 并点名缺失项（chief merge_builds 与 REST /builds/{id}/merge 两
  // 生产者同摄于此）。build 槽未指派 = 无权限主体可判，不拦（未指派步不可
  // 领是既有语义）。
  const buildAgentId = todoRow.assignment?.build?.agentId;
  if (buildAgentId) {
    const agentRow = deps.db.select().from(agent).where(eq(agent.id, buildAgentId)).get();
    if (agentRow) {
      const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter(
        (t) => !agentRow.tools.includes(t),
      );
      if (missing.length > 0) {
        throw new HttpError(
          403,
          `Agent ${agentRow.displayName} 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），无法发起合并`,
        );
      }
    }
  }
  // 时间线「发起了合并」行（r3 §3.6 实测：`15:06 Xmon Dai 发起了合并`；
  // 行形 [设计]——role user 纯文本 = shared MERGE_ANNOUNCEMENT 单源，呈现层
  // 拼装时间/actor）。
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  enqueueStep(deps, buildId, 'merge', todoRow.teamId);
  return { delegated: true };
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
  errorMessage: string,
): void {
  const { db } = deps;
  db.update(step).set({ status: 'failed' }).where(eq(step.id, stepRow.id)).run();
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
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

/** worker 步（plan/build/merge/review）失联 sweep（scheduler tick 驱动）：
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
 * 不动（挂起等机器——含钉选机离线/闸挡/楔住的形态，机器回归、开 runtime、
 * daemon 恢复领取后由 claim 循环自动续跑）；在线机器上曾有心跳后停更的
 * claimed 步（执行/推送通道部分存活的歧义态，等 presence 过期走 ②）。
 * chief 步不在本面（chief.ts 扫尾）。
 * 释放语义：status → pending + machineId 清空（认领原子位复位，他机/同机可
 * 重领）；pinnedMachineId 保留（钉选过滤重算，钉选机才能接）；claimedAt/
 * lastHeartbeatAt 保留作死亡时刻审计（重领即覆写）；createdAt 不动（FIFO
 * 序）；todo 相位不动（building + pending 步 = 合法排队）；build.errorMessage
 * 不写（非失败）；会话流 step 事件（pending 态）+ 团队 wake（他机 75s 长轮询
 * 不等满）。new-session 降级标记归 daemon 侧（续接失败回退即插 transcript
 * 注记）。
 * 幂等：只扫 pending/claimed，终态步天然跳过。 */
export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'merge', 'review']),
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
        releaseClaimedStep(deps, row, todoRow);
      }
    }
  }
}

/** 失联 claimed 步释放（#862 T1 跨机续跑的 server 半）：认领原子位复位，他机
 * 经 claimCandidates（含钉选过滤）重领。调用方已取 todo 行，透传免重查。 */
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
  outcome: { hasChanges?: boolean },
): string | null {
  if (stepRow.kind === 'plan') {
    const planRow = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (planRow !== undefined) return null;
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
  if (stepRow.kind === 'build' && outcome.hasChanges === false) {
    return '构建零改动';
  }
  return null;
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
    deps.db.update(step).set({ status: 'done' }).where(eq(step.id, stepId)).run();
    return;
  }
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) {
    deps.db.update(step).set({ status: 'done' }).where(eq(step.id, stepId)).run();
    return;
  }
  // 产物闸（#703）：失败收尾不落 done（完成判据 = 契约产物存在，不是会话
  // 结束——B-C10 空方案 / B-C11 零改动 / B-C14 假完成同病族）。
  const gateFailure = stepArtifactGate(deps, stepRow, outcome);
  if (gateFailure !== null) {
    applyStepFailure(deps, stepRow, gateFailure);
    return;
  }
  deps.db.update(step).set({ status: 'done' }).where(eq(step.id, stepId)).run();

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
    // 行为逐字节不变。
    const projRow = deps.db.select().from(project).where(eq(project.id, todoRow.projectId)).get();
    const deliveredGithubPr =
      buildRow.prNumber !== null && projRow?.repoKind === 'github' && projRow.githubRepo !== null;
    if (!deliveredGithubPr) {
      setTodoPhase(deps, todoRow.id, 'review', {
        hasChanges: outcome.hasChanges ?? true,
      });
      // #1250（ADR 0018 层 1）：review 关口抵达 → Verifier 入队（槽空零动作，
      // 幂等见函数注）。
      maybeEnqueueVerifyStep(deps, todoRow, stepRow.buildId);
      return;
    }
    // 相位已被人工推进/关闭（failed/closed——sweep 失联收尾先落、机器复活迟到
    // done 的竞态窗）→ 不回拽不抛：迟到回报照常收（步 done、PR 在 build 行），
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
    const verdict: VerifyVerdict = outcome.verifyVerdict ?? {
      passed: false,
      conclusion: outcome.verifyVerdictError !== undefined ? '判定提取失败' : '验证未返回结论',
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
  // merge 步成 → done + 🎉（时间线「发起了合并」+ 结果行 + `🎉 任务已完成`，
  // r3 §3.6；celebration 行 [设计] = role system 纯文本）。
  setTodoPhase(deps, todoRow.id, 'done');
  insertMessageRow(deps, buildRow.id, {
    id: newRecordId(),
    role: 'system',
    content: '🎉 任务已完成',
    createdAt: nowMs(),
  });
  // #1250（ADR 0018 层 2）：done 落地即查拆卡波次——本卡是子项时推进其父的
  // 下一波（父自动收口在 setTodoPhase 的 settleSplitOnDone 半边，Todos 层）。
  advanceSplitWaves(deps, todoRow.id);
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
