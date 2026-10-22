// notification record——02 §9.1（r5 §7.2 实测改判：三事件矩阵）。
// 复刻投递（Q6 终裁，#45）：SSE notification 事件 + 页内 new Notification()
// （document.hidden 时弹）；Web Push/VAPID 不进 spec = 已裁决有意 divergence
// （04 §5 验收口径，登记在案不判负）。
// 触发矩阵（r5 §7.2）：plan_ready（进 confirm）/ build_review（进 review，
// 含定时轮停 review——无独立「定时轮结束」类型）/ chief_message（Chief 线程
// 消息，snippet=消息全文）；进 done、进 failed 无 in-app 通知事件。
// #1261 增 quota_wait：任务因 relay 额度空/限流挂起「等额度」（不是失败——
// 失败不通知的原判不破；挂起是「需要你知道但无需你动手」的新一类：额度恢复
// 自动续跑，通知的意义 = 零进展期间不再静默）。snippet = 哪一路 relay + 恢复
// 探测时刻。
// #1493 增 model_fallback：降级链把任务换到备用模型接着跑（同属「需要你知道
// 但无需你动手」）。snippet = 从哪个模型换到哪个 + 原因。

import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const NOTIFICATION_TYPES = [
  'plan_ready',
  'build_review',
  'chief_message',
  'quota_wait',
  'model_fallback',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** channels 实测恒 ["in_app"]（无有效订阅时，r5 §7.2）；复刻按 R1 divergence
 * 恒 in_app（04 §5：桌面层走页内 Notification，非 wire channel）。 */
export const notificationChannelSchema = z.enum(['in_app']);

/** entityRef（r5 §7.2）：todo 类事件 = title/projectId/seqNum；
 * chief_message = thread title（projectId/seqNum 为 null [推断]）。 */
export const notificationEntityRefSchema = z.object({
  title: z.string(),
  projectId: recordId.nullable(),
  seqNum: z.number().int().nullable(),
});

export const notificationRecordSchema = z.object({
  teamId: recordId,
  userId: recordId,
  type: notificationTypeSchema,
  /** todoId 或 chief-threadId（02 §9.1）。 */
  entityId: recordId,
  entityRef: notificationEntityRefSchema,
  agent: z.object({
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  /** plan_ready/build_review = null；chief_message = 消息全文（r5 §7.2）。 */
  snippet: z.string().nullable(),
  /** 组合键 `"<userId>:<entityId>"`（r5 §7.2 原样）。 */
  id: z.string(),
  readAt: epochMs.nullable(),
  createdAt: epochMs,
  channels: z.array(notificationChannelSchema),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

/** GET /api/teams/{id}/notifications → {unreadThreadIds}（02 §9.1：站内未读
 * + 徽标联动）。 */
export const notificationsResponseSchema = z.object({
  unreadThreadIds: z.array(z.string()),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

/** 看板顶部引导条文案 canon（r3 §7/02 §9.1：对应 push+前台抑制语义；复刻
 * divergence 下兑现「后台提醒」语义，04 §5）。 */
export const NOTIFICATION_BANNER_COPY = {
  title: '浏览器通知未开启',
  body: '标签页切换到后台时，通过桌面通知提醒你。',
  action: '开启',
} as const;
