// 分支对话框「同步到机器」服务层（M7 #319，08 册 §3 story 10 + 附录 B）：
// 状态机落账 + team stream `branch_sync` 事件推送 + machine wire sync 命令派发。
// 状态机 = pending → running → synced | failed（pending/running 走 server 端
// createBranchSync/runningBranchSync；synced/failed 走 daemon 回写
// transitionBranchSync）。force 语义 = 丢弃修改 + 删未跟踪文件，仅本次生效
// （r1 changelog 09-13）。

import type { BranchSyncRecord, BranchSyncStatus, MachineSyncCommand } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { branchSync, build as buildTable, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';

/** machine sync 命令派发通道（缝纪律：MACHINE_WIRE_EXTENSIONS + sync 事件
 * 通过 MachineWakeHub 流式派发）。web 团队流事件 + 机器 stream 事件共用一个
 * hub 实例，避免跨进程路由拆分。MachineWakeHub 直接实现本接口（pushSync
 * 同名同形 [设计]）。 */
export interface MachineSyncHub {
  /** 定向派发 sync 命令到指定 machine（机器 stream SSE 未连 = 派发失败，
   * 调用方按 machine.online 先行校验，hub 自身不再过滤）。 */
  pushSync(machineId: string, cmd: MachineSyncCommand): boolean;
}

export interface BranchSyncCreateDeps {
  db: Db;
  hub: TeamStreamHub;
  /** machine wire 推送通道（MachineWakeHub 实例，含 pushSync 派发）。 */
  machineHub: MachineSyncHub;
}

export interface BranchSyncTransitionDeps {
  db: Db;
  hub: TeamStreamHub;
}

/** pending 行落账 + team stream 推送 + machine wire 派发。
 * 流程：先写 pending 行 → 推 sync 事件给目标 machine stream → 返回新行。
 * 失败面：machine 不在线（machineHub.pushSync 返 false）= 标 failed + 推团
 * 队流 → 抛 409（前端结果卡显示 failed，wire 同步失败语义）。 */
export function createBranchSync(
  deps: BranchSyncCreateDeps,
  input: {
    buildId: string;
    machineId: string;
    teamId: string;
    /** 同步目标的 clone URL（hosted = server bare；github = github.com）。
     * daemon 据此对目标机无基座仓情形做匿名 clone。null = 未绑 repo 项目
     * （web 默认值——无 repo 项目同步语义弱，仅在已有 worktree 的机器上有效）。 */
    projectId: string | null;
    cloneUrl: string | null;
    directory: string;
    ref: string;
    commit: string;
    force: boolean;
  },
): BranchSyncRecord {
  const { db, hub, machineHub } = deps;
  // 校验 build 存在（cascade delete 保护 + 路由侧早失败）
  const buildRow = db.select().from(buildTable).where(eq(buildTable.id, input.buildId)).get();
  if (!buildRow) throw new HttpError(404, `build ${input.buildId} not found`);
  // 校验 machine 存在 + 在线（machineHub 派发 = SSE 连着 = online）
  const machineRow = db.select().from(machine).where(eq(machine.id, input.machineId)).get();
  if (!machineRow) throw new HttpError(404, `machine ${input.machineId} not found`);
  if (!machineRow.online) throw new HttpError(409, 'machine offline');

  const id = newRecordId();
  const now = nowMs();
  db.insert(branchSync)
    .values({
      id,
      buildId: input.buildId,
      machineId: input.machineId,
      teamId: input.teamId,
      directory: input.directory,
      ref: input.ref,
      commit: input.commit,
      force: input.force,
      status: 'pending',
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    })
    .run();
  const row = toBranchSyncRecord({
    id,
    buildId: input.buildId,
    machineId: input.machineId,
    teamId: input.teamId,
    directory: input.directory,
    ref: input.ref,
    commit: input.commit,
    force: input.force,
    status: 'pending',
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  });

  // 推送团队流（web 端结果卡瞬态）
  hub.publish(input.teamId, () => ({ type: 'branch_sync', sync: row }));

  // 派发 machine wire 命令（机器 stream SSE）
  const dispatched = machineHub.pushSync(input.machineId, {
    syncId: id,
    buildId: input.buildId,
    projectId: input.projectId ?? '',
    cloneUrl: input.cloneUrl ?? '',
    directory: input.directory,
    ref: input.ref,
    commit: input.commit,
    force: input.force,
  });
  if (!dispatched) {
    // 派发失败（机器 stream 断连中间态）= 立即改 failed + 推团队流
    db.update(branchSync)
      .set({
        status: 'failed',
        errorMessage: 'machine stream disconnected before pickup',
        finishedAt: nowMs(),
      })
      .where(eq(branchSync.id, id))
      .run();
    const updated = toBranchSyncRecord({
      ...row,
      status: 'failed',
      errorMessage: 'machine stream disconnected before pickup',
      finishedAt: nowMs(),
    });
    hub.publish(input.teamId, () => ({ type: 'branch_sync', sync: updated }));
    throw new HttpError(409, 'machine stream disconnected');
  }
  return row;
}

/** daemon 回写状态过渡。状态机只允许 pending → running → synced/failed。
 * running 必须从 pending 推进（不允许 running → running 重复跑）；终态
 * （synced/failed）只可写一次。错误状态 = 409。本函数仅需 db + hub（不
 * 派发新 wire 命令）——transition 不写 new sync 事件，所以不挂 MachineSyncHub。 */
export function transitionBranchSync(
  deps: BranchSyncTransitionDeps,
  input: {
    syncId: string;
    machineId: string;
    status: Extract<BranchSyncStatus, 'running' | 'synced' | 'failed'>;
    errorMessage?: string;
  },
): BranchSyncRecord {
  const { db, hub } = deps;
  const row = db.select().from(branchSync).where(eq(branchSync.id, input.syncId)).get();
  if (!row) throw new HttpError(404, `sync ${input.syncId} not found`);
  if (row.machineId !== input.machineId) {
    throw new HttpError(403, `sync ${input.syncId} not owned by machine ${input.machineId}`);
  }
  if (row.status === 'synced' || row.status === 'failed') {
    // 终态不可改
    return toBranchSyncRecord(row);
  }
  // 校验合法过渡
  const valid =
    (row.status === 'pending' && input.status === 'running') ||
    (row.status === 'running' && (input.status === 'synced' || input.status === 'failed')) ||
    (row.status === 'pending' && (input.status === 'synced' || input.status === 'failed'));
  if (!valid) {
    throw new HttpError(409, `invalid sync transition: ${row.status} -> ${input.status}`);
  }
  const now = nowMs();
  const update: Partial<typeof branchSync.$inferInsert> = { status: input.status };
  if (input.status === 'running') {
    update.startedAt = row.startedAt ?? now;
  }
  if (input.status === 'synced' || input.status === 'failed') {
    update.finishedAt = now;
    update.errorMessage = input.errorMessage ?? null;
  }
  db.update(branchSync).set(update).where(eq(branchSync.id, input.syncId)).run();
  const next = db.select().from(branchSync).where(eq(branchSync.id, input.syncId)).get();
  if (!next) throw new HttpError(500, `sync ${input.syncId} vanished`);
  const record = toBranchSyncRecord(next);
  hub.publish(record.teamId, () => ({ type: 'branch_sync', sync: record }));
  return record;
}

/** 查 build 最新一次 sync 行（web 端 GET 端点封套）。无 sync 行 = null
 * （前端结果卡不显示，与原「同步钮恒 disabled」语义区分）。 */
export function latestBranchSyncForBuild(
  deps: { db: Db },
  buildId: string,
): BranchSyncRecord | null {
  const { db } = deps;
  const row = db
    .select()
    .from(branchSync)
    .where(eq(branchSync.buildId, buildId))
    .orderBy(branchSync.createdAt)
    .all()
    .at(-1);
  return row ? toBranchSyncRecord(row) : null;
}

function toBranchSyncRecord(r: typeof branchSync.$inferSelect): BranchSyncRecord {
  return {
    id: r.id,
    buildId: r.buildId,
    machineId: r.machineId,
    teamId: r.teamId,
    directory: r.directory,
    ref: r.ref,
    commit: r.commit,
    force: r.force,
    status: r.status,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
  };
}
