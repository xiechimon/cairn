// schedule record——02 §6.2（r3 §8.3 实测原样）。
// 闭环语义（02 §9.2/r3 §9）：每轮触发全新 build、到确认/审核关口暂停、
// 时间线标「由定时发起」、`once` 触发后自动出队（GET /api/schedules?team= → []）。

import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';

/** kind 观测值 `once`；`每小时/每天/每周` tab 的枚举词 [推断]
 * （02 §6.2：docs/UI 未见 wire 值，候选 hourly/daily/weekly，实现按 UI tab
 * 逆推，可改判；04 册附录 A：M2 定时实现期重放补采）。 */
export const scheduleKindSchema = z.enum(['once', 'hourly', 'daily', 'weekly']);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;

/** 单次档时间选择约束（r3 §9 实测）：时 00–23、分 00/15/30/45 四档。 */
export const SCHEDULE_MINUTE_STEPS = [0, 15, 30, 45] as const;

/** 内嵌 todo 摘要（r3 §8.3 实测原样）。 */
export const scheduleTodoEmbedSchema = z.object({
  seqNum: z.number().int(),
  title: z.string(),
  phase: phaseSchema,
  projectName: z.string(),
  ownerId: recordId,
});

/** POST /api/schedules body [推断]（wire 未采；字段 = record 可写子集投影，
 * 04 附录 A 补采后收紧）。语义（r3 §9 表单面）：
 * - `once`：at = 触发时刻（日期 + 时间，时 00–23、分 00/15/30/45 四档）；
 * - 周期档：at = 墙钟锚点（hourly 取分钟档、daily 取时:分、weekly 另取星期），
 *   nextRunAt 由 cron 按 tz 滚动计算；
 * - tz 缺省 = server 本地时区（「按你的本地时区运行（…）」注，01 §4.2）；
 */ export const createScheduleBodySchema = z.object({
  todoId: recordId,
  projectId: recordId.optional(),
  kind: scheduleKindSchema,
  at: epochMs,
  tz: z.string().optional(),
});
export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

export const scheduleRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  todoId: recordId,
  kind: scheduleKindSchema,
  /** 触发时刻 epoch ms（r3 §8.3 `at:<ms>`）；周期档下语义未分离观测，
   * null 容忍 [推断]。 */
  at: epochMs.nullable(),
  /** IANA 时区（r3 §8.3 样例 "Asia/Shanghai"）；tz 注「按你的本地时区运行（…）」
   * （r3 §9），server 侧取 Intl.DateTimeFormat().resolvedOptions().timeZone
   * （01 §4.2）。 */
  tz: z.string(),
  nextRunAt: epochMs.nullable(),
  createdBy: recordId,
  todo: scheduleTodoEmbedSchema,
});
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
