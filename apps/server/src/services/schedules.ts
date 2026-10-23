// schedule 服务面（02 §6.2 record + §9.2 cron 词表照抄；r3 §9 表单/列表/闭环
// 实测）。nextRunAt 计算 = cron-parser 纯解析（01 §4.2 pin 5.10.1；本模块是
// server 内唯一 cron-parser import 点，Scheduler 缝纪律 01 §3）。
// 词表（r3 §9/r5 §8 复核）：
// - 频率档 kind：`每小时/每天/每周/单次` → hourly/daily/weekly（[推断] 枚举词，
//   02 §6.2 候选，04 附录 A 补采后收紧）/ once。
// - 分档：触发分钟 ∈ 00/15/30/45 四档（SCHEDULE_MINUTE_STEPS 单源，r5 §8 复核）。
// - tz 注「按你的本地时区运行（…）」：缺省 = server 本地时区
//   （Intl…resolvedOptions().timeZone，01 §4.2）。
// - once 触发后自动出队（r3 §9：GET /api/schedules?team= → []）。

import type { CreateScheduleBody, ScheduleKind, ScheduleRecord } from '@cairn/shared';
import { SCHEDULE_MINUTE_STEPS } from '@cairn/shared';
// 缝实现位：cron-parser 只在本模块出现（01 §3 Scheduler 缝纪律）。
import { CronExpressionParser } from 'cron-parser';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { schedule, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';

export interface ScheduleDeps {
  db: Db;
  hub: TeamStreamHub;
}

type ScheduleRow = typeof schedule.$inferSelect;

/** server 本地时区（tz 注缺省值，01 §4.2）。 */
export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** at（epoch ms）在 tz 下的墙钟部件（cron 表达式拼装源）。 */
export function wallClockParts(
  atMs: number,
  tz: string,
): { minute: number; hour: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    minute: 'numeric',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(atMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // hour12:false 的午夜在部分 ICU 版本出 `24`——归一为 0。
  const hour = Number.parseInt(get('hour'), 10) % 24;
  return { minute: Number.parseInt(get('minute'), 10), hour, dow: DOW[get('weekday')] ?? 0 };
}

/** 分档校验（r3 §9/02 §9.2：「单次=日期+时间（时 00–23、分 00/15/30/45 四档）」
 * ——四档绑定单次档；周期档锚点是否共用同一 picker 未分离观测 [推断]，不做
 * server 侧收窄（04 §3 [推断] 口径），补采后收紧。 */
export function assertMinuteStep(atMs: number, tz: string): void {
  const { minute } = wallClockParts(atMs, tz);
  if (!(SCHEDULE_MINUTE_STEPS as readonly number[]).includes(minute)) {
    throw new HttpError(
      400,
      `invalid schedule minute: ${minute} (allowed steps: ${SCHEDULE_MINUTE_STEPS.join('/')})`,
    );
  }
}

/** 周期档判定（once 之外的三档；出队/滚动分岐的单源判别）。 */
export function isRecurring(kind: ScheduleKind): kind is Exclude<ScheduleKind, 'once'> {
  return kind !== 'once';
}

/** kind → 5 字段 cron 表达式（分 时 日 月 周；锚 = at 在 tz 下的墙钟部件）。 */
export function cronExpressionFor(kind: ScheduleKind, atMs: number, tz: string): string | null {
  if (!isRecurring(kind)) return null; // 单次不走 cron（at 即触发时刻）
  const { minute, hour, dow } = wallClockParts(atMs, tz);
  switch (kind) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dow}`;
  }
}

/** 下一次触发（epoch ms）：once = at；周期档 = cron 严格晚于 fromMs 的首个
 * 落点（tz 感知）。 */
export function computeNextRunAt(
  kind: ScheduleKind,
  atMs: number,
  tz: string,
  fromMs: number,
): number {
  if (!isRecurring(kind)) return atMs;
  const expr = cronExpressionFor(kind, atMs, tz);
  if (expr === null) throw new Error(`unreachable: recurring kind expected, got ${kind}`);
  const interval = CronExpressionParser.parse(expr, {
    tz,
    currentDate: new Date(fromMs),
  });
  return interval.next().getTime();
}

/** record 投影：内嵌 todo 摘要（r3 §8.3 实测原样
 * `todo:{seqNum,title,phase,projectName,ownerId}`）。 */
export function toScheduleRecord(deps: ScheduleDeps, row: ScheduleRow): ScheduleRecord | null {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) return null; // todo 已删 = 孤儿行（触发面自愈删除，scheduler.ts）
  const projectRow = projectOfTodo(deps.db, todoRow);
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    todoId: row.todoId,
    kind: row.kind,
    at: row.at,
    tz: row.tz,
    nextRunAt: row.nextRunAt,
    createdBy: row.createdBy,
    todo: {
      seqNum: todoRow.seqNum,
      title: todoRow.title,
      phase: todoRow.phase,
      projectName: projectRow?.name ?? '',
      // ownerId 槽非空（r3 §8.3 样本恒有值）；todo 侧可空时回退 createdBy [推断]。
      ownerId: todoRow.ownerId ?? todoRow.createdBy ?? '',
    },
  };
}

/** GET /api/schedules?team=（r3 §8.2；once 出队后 → []，r3 §9）。 */
export function listSchedules(deps: ScheduleDeps, teamId: string): ScheduleRecord[] {
  return deps.db
    .select()
    .from(schedule)
    .where(eq(schedule.teamId, teamId))
    .all()
    .map((row) => toScheduleRecord(deps, row))
    .filter((r): r is ScheduleRecord => r !== null);
}

/** POST /api/schedules（body = shared createScheduleBodySchema [推断]）。 */
export function createSchedule(
  deps: ScheduleDeps,
  input: CreateScheduleBody & { teamId: string; createdBy: string },
): ScheduleRecord {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, input.todoId)).get();
  if (!todoRow) throw new HttpError(404, `todo ${input.todoId} not found`);
  const projectId = input.projectId ?? todoRow.projectId;
  if (projectId !== todoRow.projectId) {
    throw new HttpError(400, 'invalid projectId: todo belongs to another project');
  }
  const tz = input.tz ?? serverTimezone();
  if (!isRecurring(input.kind)) assertMinuteStep(input.at, tz); // 四档绑定单次（02 §9.2）
  const now = nowMs();
  const id = newRecordId();
  const nextRunAt = computeNextRunAt(input.kind, input.at, tz, now);
  deps.db
    .insert(schedule)
    .values({
      id,
      teamId: input.teamId,
      projectId,
      todoId: input.todoId,
      kind: input.kind,
      at: input.at,
      tz,
      nextRunAt,
      createdBy: input.createdBy,
    })
    .run();
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  const record = row ? toScheduleRecord(deps, row) : null;
  if (!record) throw new Error('schedule missing after insert');
  return record;
}

/** DELETE /api/schedules/{id}（DELETE_FACE 'schedules' 同名 DELETE [推断]；
 * unschedule_todo 词表证据 r5 §3.1）。返回是否存在并删除。 */
export function deleteSchedule(deps: ScheduleDeps, id: string): boolean {
  const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!row) return false;
  deps.db.delete(schedule).where(eq(schedule.id, id)).run();
  return true;
}

/** 到期行（nextRunAt <= now；调度循环扫描面）。 */
export function dueSchedules(deps: ScheduleDeps, nowMsValue: number): ScheduleRow[] {
  return deps.db
    .select()
    .from(schedule)
    .where(and(isNotNull(schedule.nextRunAt), lte(schedule.nextRunAt, nowMsValue)))
    .all();
}

export function updateNextRunAt(deps: ScheduleDeps, id: string, nextRunAt: number | null): void {
  deps.db.update(schedule).set({ nextRunAt }).where(eq(schedule.id, id)).run();
}
