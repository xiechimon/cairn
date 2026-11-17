import { z } from 'zod';

export const IM_CONNECTION_STATUSES = [
  'connecting',
  'ready',
  'degraded',
  'expired',
  'error',
] as const;
export type ImConnectionStatus = (typeof IM_CONNECTION_STATUSES)[number];

export const IM_PLATFORMS = ['telegram', 'wechat'] as const;
export type ImPlatform = (typeof IM_PLATFORMS)[number];

export const IM_PAIRING_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ImPairingRequestStatus = (typeof IM_PAIRING_REQUEST_STATUSES)[number];

export const imPairedSenderSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  chatKey: z.string().nullable(),
  addedAt: z.number().int(),
});
export type ImPairedSender = z.infer<typeof imPairedSenderSchema>;

export const imConnectionRecordSchema = z.object({
  id: z.string(),
  platform: z.enum(IM_PLATFORMS),
  accountLabel: z.string().nullable(),
  status: z.enum(IM_CONNECTION_STATUSES),
  statusDetail: z.string().nullable(),
  pairedSenders: z.array(imPairedSenderSchema),
  lastSendError: z.string().nullable(),
  createdAt: z.number().int(),
});
export type ImConnectionRecord = z.infer<typeof imConnectionRecordSchema>;

export const imPairingRequestRecordSchema = z.object({
  id: z.string(),
  connId: z.string(),
  platform: z.enum(IM_PLATFORMS),
  senderId: z.string(),
  senderName: z.string().nullable(),
  chatKey: z.string(),
  status: z.enum(IM_PAIRING_REQUEST_STATUSES),
  requestedAt: z.number().int(),
  decidedAt: z.number().int().nullable(),
});
export type ImPairingRequestRecord = z.infer<typeof imPairingRequestRecordSchema>;

export const imTelegramConnectBodySchema = z
  .object({ botToken: z.string().min(1).max(256) })
  .strict();
export type ImTelegramConnectBody = z.infer<typeof imTelegramConnectBodySchema>;
