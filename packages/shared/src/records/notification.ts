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

export const notificationChannelSchema = z.enum(['in_app']);

export const notificationEntityRefSchema = z.object({
  title: z.string(),
  projectId: recordId.nullable(),
  seqNum: z.number().int().nullable(),
});

export const notificationRecordSchema = z.object({
  teamId: recordId,
  userId: recordId,
  type: notificationTypeSchema,
  entityId: recordId,
  entityRef: notificationEntityRefSchema,
  agent: z.object({
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  snippet: z.string().nullable(),
  id: z.string(),
  readAt: epochMs.nullable(),
  createdAt: epochMs,
  channels: z.array(notificationChannelSchema),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const notificationsResponseSchema = z.object({
  unreadThreadIds: z.array(z.string()),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

export const NOTIFICATION_BANNER_COPY = {
  title: '浏览器通知未开启',
  body: '标签页切换到后台时，通过桌面通知提醒你。',
  action: '开启',
} as const;
