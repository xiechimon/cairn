// 配额挂起面（#1261）：daemon 熔断上报的 quotaBlock 在 server 侧落
// waiting_quota 挂起 + 探测到期释放回 pending 自动续跑。语义三钉：
//  - **不判死**：quota 挂起不走 applyStepFailure 漏斗（todo 不落 failed、
//    build.errorMessage 不写）——额度空/限流是配额事件不是任务失败（Multica
//    taskfailure/classify.go 的 quota/capacity 桶同律：明确不可重试 ≠ 失败）。
//  - **可见**：挂起即 in-app 通知（quota_wait 行）+ todo doc 重发布（板面
//    quotaWait 投影 = 「等额度」态数据源）+ 会话流 step 事件（详情页进度行）。
//    不可见即污染可观测性——用户实测 8 槽空转全程零感知正是反面。
//  - **自愈**：probeAt 到期 sweep 释放回 pending（machineId 清空、wake 全队）
//    ——额度恢复后无人工操作续跑；仍配额 → daemon 再报 → 退避 ×2 重挂
//    （首见时刻保持，挂起史不重置）。
//
// 分层纪律：本模块可 import todos（getTodo——todo doc 重发布面），todos.ts
// **不得**反向 import 本模块（toTodoRecord 的 quotaWait 派生用内联查询，
// 投影同形由 quota-wait.test W3 钉住防漂移）。

import type { QuotaBlock, QuotaWait, UserRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, type QuotaWaitRow, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyQuotaWait } from './notifications.js';
import { getTodo } from './todos.js';

export interface QuotaWaitDeps {
  db: Db;
  hub: TeamStreamHub;
  convHub?: ConversationStreamHub;
  machineHub?: MachineWakeHub;
  /** 通知收件人（quota_wait 首挂行）。 */
  user: UserRecord;
}

/** 首个探测窗基数（无 Retry-After 时的缺省）：1 分钟。验收面「3 分钟内板面
 * 出现等额度态」由挂起即时事件承担；探测窗只管续跑节奏——1 分钟是「限流
 * 秒级恢复」与「不打爆 relay」之间的折中。 */
export const QUOTA_PROBE_BASE_MS = 60_000;

/** 探测窗上限：连续挂起的退避封顶（30 分钟——每半小时一次零 token 的
 * 首请求探测，风暴面在 relay 侧无感）。 */
export const QUOTA_PROBE_MAX_MS = 30 * 60_000;

type StepRow = typeof step.$inferSelect;

/** 挂起史行 → 读面投影（kind/providerId/label/retryAfterMs/probeAt；挂起史
 * 字段 firstSeenAt/lastAt/attempts 不上读面——板面只答「哪一路、何时探测」）。 */
export function toQuotaWait(row: QuotaWaitRow): QuotaWait {
  return {
    kind: row.kind,
    providerId: row.providerId,
    label: row.label,
    retryAfterMs: row.retryAfterMs,
    probeAt: row.probeAt,
  };
}

/** 探测窗（退避 ×2 封顶 MAX）：基数 = 本次上报的 Retry-After（无则 BASE）。
 * attempts = 同 provider 连续挂起次数（重挂递增；换 provider 重置——换路
 * 续跑是配额事件的新事实，退避史不继承）。 */
function probeWindowMs(base: number, attempts: number): number {
  return Math.min(base * 2 ** (attempts - 1), QUOTA_PROBE_MAX_MS);
}

/** 会话流 step 事件行（挂起/释放两态共用；形状 = stepJournalRowSchema 的
 * journal 位投影，quotaWait 挂起态携带）。 */
export function publishStepRow(deps: Pick<QuotaWaitDeps, 'convHub'>, row: StepRow): void {
  deps.convHub?.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection: row.skillInjection ?? null,
    ...(row.status === 'waiting_quota' && row.quotaBlock !== null
      ? { quotaWait: toQuotaWait(row.quotaBlock) }
      : {}),
  });
}

/** 挂起落账（finishStep 的 quota 分支调用）：step → waiting_quota + 挂起块 +
 * 首挂通知 + 会话流 step 事件 + todo doc 重发布。幂等输入：同 provider 重挂
 * = attempts+1（探测窗退避），不通知（首挂已 ping，重挂只刷新板面）。 */
export function applyQuotaWaitStep(deps: QuotaWaitDeps, stepRow: StepRow, block: QuotaBlock): void {
  const now = nowMs();
  const prev = stepRow.quotaBlock;
  const sameLane = prev !== null && prev.providerId === block.providerId;
  const attempts = sameLane ? prev.attempts + 1 : 1;
  const base = block.retryAfterMs ?? QUOTA_PROBE_BASE_MS;
  const row: QuotaWaitRow = {
    kind: block.kind,
    providerId: block.providerId,
    label: block.label ?? null,
    reason: block.reason,
    retryAfterMs: block.retryAfterMs ?? null,
    firstSeenAt: sameLane ? prev.firstSeenAt : now,
    lastAt: now,
    attempts,
    probeAt: now + probeWindowMs(base, attempts),
  };
  deps.db
    .update(step)
    .set({ status: 'waiting_quota', quotaBlock: row })
    .where(eq(step.id, stepRow.id))
    .run();
  const fresh = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (fresh !== undefined) publishStepRow(deps, fresh);
  // todo doc 重发布（板面 quotaWait 投影失效重取）。chief 步无 todo 行——
  // 会话流 step 事件已覆盖 chief 面重取。
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (buildRow !== undefined) {
    const record = getTodo(deps, buildRow.todoId);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  // 首挂通知（quota_wait 行，组合键覆盖语义同 todo 类事件）。
  if (attempts === 1 && buildRow !== undefined) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow) notifyQuotaWait(deps, todoRow, row);
  }
}

/** 步的 team 归属（worker → build→todo；chief → chief_thread）。 */
function teamOfStep(db: Db, row: StepRow): string | null {
  const buildRow = db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (buildRow !== undefined) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    return todoRow?.teamId ?? null;
  }
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
  return thread?.teamId ?? null;
}

/** 探测到期释放（scheduler tick 驱动）：waiting_quota 且 probeAt ≤ now 的步
 * → pending + machineId 清空（认领原子位复位，#862 释放语义同律；quotaBlock
 * 列保留 = 挂起史，重挂时 attempts 续接）+ 全队 wake（他机 75s 长轮询不等满）
 * + 会话流 step 事件 + todo doc 重发布（quotaWait 投影消失，板面回执行态）。
 * 返回释放数。防御位：quotaBlock 缺席的 waiting_quota 步（写路径 bug）立即
 * 释放——挂起面不吞步。 */
export function sweepQuotaWaitSteps(deps: QuotaWaitDeps, now: number = nowMs()): number {
  const rows = deps.db.select().from(step).where(eq(step.status, 'waiting_quota')).all();
  let released = 0;
  for (const row of rows) {
    if ((row.quotaBlock?.probeAt ?? 0) > now) continue;
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null })
      .where(eq(step.id, row.id))
      .run();
    released += 1;
    const teamId = teamOfStep(deps.db, row);
    if (teamId !== null) deps.machineHub?.wake(teamId);
    const fresh = deps.db.select().from(step).where(eq(step.id, row.id)).get();
    if (fresh !== undefined) publishStepRow(deps, fresh);
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (buildRow !== undefined) {
      const record = getTodo(deps, buildRow.todoId);
      if (record) deps.hub.publishTodoDoc(record.teamId, record);
    }
  }
  return released;
}
