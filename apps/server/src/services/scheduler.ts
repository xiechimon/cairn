// Scheduler 缝实现（shared scheduler.ts 接口；02 §9.2 server 端 cron 宿主自持，
// 00/D3 不外包 pi）。触发闭环（r3 §9 + r5 §8 实测语义）：
// - 到期 → 新 build 全新重跑：triggerSource="schedule"、直执行（观测轮 32s 直达
//   审核关口、未在方案关口停驻 [推断]）
//   （schedule 显式钉 > todo.machineId #682 任务级默认 > null 自动；r3 §9 的
//   「schedule null = 自动」现在精确为「schedule 未钉 → 回落 todo 值」）；
//   到确认/审核关口暂停 = 常规 build 流程（02 §9.2）。
// - 触发时停驻关口（confirm/review）的旧 build 标 errorMessage:"Cancelled"
//   + build 文档事件（r5 §8 实测；done 轮旧 build 已合并落地，不标 [推断]）。
// - `once` 触发后自动出队（r3 §9）；周期档滚动 nextRunAt（cron tz 感知）。
// - 进行中 phase（queued/planning/building）不抢占：本轮跳过、周期档仍滚动
//   [设计]（wire/UI 无抢占观测）。孤儿（todo 已删）自愈出队 [设计]。
// 时间线「由定时发起」= build.triggerSource 数据面（呈现归 web）。

import type { Scheduler } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, schedule, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { ATTACHMENT_GC_INTERVAL_MS, type GcLogger, sweepAttachments } from './attachment-gc.js';
import {
  type BuildDeps,
  startBuilds,
  sweepAbandonedBuildSteps,
  sweepZombieQueuedTodos,
  toBuildRecord,
} from './builds.js';
import { fireDueChiefWakes, sweepAbandonedChiefSteps } from './chief.js';
import { CI_POLL_INTERVAL_MS, type CiPollLogger, createCiPoller } from './ci-loop.js';
import type { TeamStreamHub } from './events.js';
import { sweepStaleMachines } from './machines.js';
import { PhaseTransitionError } from './phase.js';
import { computeNextRunAt, dueSchedules, isRecurring, updateNextRunAt } from './schedules.js';

export interface SchedulerOptions {
  /** 真实时间循环 tick 间隔（config schedulerTickMs）。 */
  tickMs: number;
}

/** #1150 CI 磨绿环运行位：轮询器挂本调度器家族——自有 60s 循环
 * （CI_POLL_INTERVAL_MS，与 tick 的 15s 分道——tick 是同步契约（shared
 * Scheduler.tick: void），网络读不进 tick；GC 的 sweep 是纯 fs 才能 piggyback）。
 * 缺省/null = 不开轮询（既有调用零改动）。githubFetch 是轮询的出站读位
 * （AppContext.githubFetch 同族），logger = 对账行（每 sweep 一行）。 */
export interface CiPollRun {
  githubFetch: FetchLike;
  logger: CiPollLogger;
}

/** 附件回收运行位（#759：tick piggyback，缺省 = 不开回收——既有调用零改动）。 */
export interface AttachmentGcRun {
  attachmentsDir: string;
  logger: GcLogger;
}

/** 触发时旧 build 标 Cancelled 的关口集（r5 §8：停驻轮被新轮顶替）。 */
const CANCEL_GATE_PHASES = new Set(['confirm', 'review']);

export function createScheduler(
  deps: BuildDeps,
  opts: SchedulerOptions,
  gc?: AttachmentGcRun | null,
  ci?: CiPollRun | null,
): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  // #1150 CI 磨绿环轮询器（可选运行位）：start/stop 生命周期与 tick 同家族；
  // sweep 自带 per 候选容错 + 对账日志，循环兜底 catch 防 interval 上抛。
  const ciPoller =
    ci !== undefined && ci !== null
      ? createCiPoller(deps, { githubFetch: ci.githubFetch, logger: ci.logger })
      : null;
  let ciTimer: NodeJS.Timeout | null = null;
  // 回收限流位（内存记上次 sweep 时刻；多实例同库时各自限流，重复 sweep
  // 无害——Victim 判定幂等，删过即无行）。
  let lastGcAt = 0;

  function cancelGateBuild(db: Db, hub: TeamStreamHub, todoId: string): void {
    const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
    if (!todoRow || !CANCEL_GATE_PHASES.has(todoRow.phase) || todoRow.latestBuildId === null) {
      return;
    }
    const buildId = todoRow.latestBuildId;
    db.update(build)
      .set({ errorMessage: 'Cancelled' }) // r5 §7.2 实测字面值
      .where(eq(build.id, buildId))
      .run();
    const row = db.select().from(build).where(eq(build.id, buildId)).get();
    if (row) hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
  }

  function tick(now = nowMs()): void {
    const due = dueSchedules(deps, now);
    for (const row of due) {
      const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
      if (!todoRow) {
        // 孤儿自愈：todo 已删 → 出队 [设计]。
        deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
        continue;
      }
      try {
        cancelGateBuild(deps.db, deps.hub, row.todoId);
        startBuilds(deps, {
          projectId: row.projectId,
          todoIds: [row.todoId],
          assignment: todoRow.assignment ?? { plan: null, build: null },
          withPlan: false,
          triggerSource: 'schedule',
        });
      } catch (err) {
        if (err instanceof PhaseTransitionError) {
          // 进行中/搁置 phase：本轮不触发。周期档仍滚动（同一落点不重复尝试）；
          // once 保留 nextRunAt，todo 可重跑后的下一 tick 补触发 [设计]。
          if (isRecurring(row.kind) && row.at !== null) {
            updateNextRunAt(deps, row.id, computeNextRunAt(row.kind, row.at, row.tz, now));
          }
          continue;
        }
        throw err;
      }
      if (!isRecurring(row.kind)) {
        // once 触发后自动出队（r3 §9：GET /api/schedules?team= → []）。
        deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
      } else if (row.at !== null) {
        updateNextRunAt(deps, row.id, computeNextRunAt(row.kind, row.at, row.tz, now));
      }
    }
    // chief set_wake 到期触发（r5 §2 关注与提醒「约定到点回头核实」；BuildDeps
    // 与 ChiefDeps 同形，直接复用）。
    fireDueChiefWakes(deps, now);
    // #1136 机器行陈旧扫掠：先于步扫尾跑——同 tick 内把静默死机（无 FIN，SSE
    // abort 抓不住）的机器翻 offline，下方两族步扫尾的「机器在线」判据立即
    // 生效（钉选宽限/释放同拍起算，不再多等一个 tick）。只翻 online 不动步。
    // 钟面取真实时钟而非本 tick 的 now：机器活性是 presence 数据的墙钟属性，
    // 而定时触发的既有驱动约定（schedules/m5 集成）会用「未来时刻」手动 tick
    // ——拿合成 now 判陈旧会把健康机器的 30s 新鲜列龄看成超龄误翻 offline
    //（#1146 CI 首轮 m5-web-e2e 定时轮腿即死于此）。
    sweepStaleMachines(deps);
    // #684 失联超时兜底：daemon 死亡后 pending/claimed chief 步永挂零反馈，
    // tick 扫尾把失联回合按失败收进 #631 可见面（chief_turn_error 行 + toast）。
    sweepAbandonedChiefSteps(deps, now);
    // #706/#862 失联扫尾：失联 claimed 步释放回 pending 供他机认领、无人认领
    // 的 pending 步按失败收尾（step 事件 + build.errorMessage + todo → failed，
    // 与机器报失败同漏斗）。
    sweepAbandonedBuildSteps(deps, now);
    // #1219 僵尸 reconcile：queued 却无活步的 todo（旧 cancel 裸 UPDATE /
    // 崩溃窗口遗留）回落释放——不修则 run_builds 409 queued→queued 停摆。
    sweepZombieQueuedTodos(deps, now);
    // #759 附件回收：tick piggyback，每小时最多扫一次（启动首 tick 即补扫）。
    // sweep 自带 try/catch——回收失败不许打断定时闭环。
    if (gc !== undefined && gc !== null && now - lastGcAt >= ATTACHMENT_GC_INTERVAL_MS) {
      lastGcAt = now;
      try {
        sweepAttachments(
          { db: deps.db, attachmentsDir: gc.attachmentsDir, logger: gc.logger },
          now,
        );
      } catch (err) {
        gc.logger.info(
          { err: err instanceof Error ? err.message : String(err) },
          'attachment gc failed (scheduler continues)',
        );
      }
    }
  }

  return {
    tick,
    start() {
      if (timer !== null) return;
      tick(); // 启动即补扫（停机期间到期行下一 tick 语义，[设计]）
      timer = setInterval(() => tick(), opts.tickMs);
      timer.unref?.(); // 测试/短命令不吊住事件循环
      // #1150 CI 磨绿环：独立 60s 循环（启动即补扫 + 周期轮询；tick 不承载——
      // tick 是同步契约，网络读只进本循环）。
      if (ciPoller !== null) {
        void ciPoller.sweep().catch(() => {}); // sweep 内部已容错，此处兜底不打进 start
        ciTimer = setInterval(() => {
          void ciPoller.sweep().catch(() => {});
        }, CI_POLL_INTERVAL_MS);
        ciTimer.unref?.();
      }
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (ciTimer !== null) {
        clearInterval(ciTimer);
        ciTimer = null;
      }
    },
  };
}
