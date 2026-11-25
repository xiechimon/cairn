import { z } from 'zod';

export const IM_CONNECTION_STATUSES = [
  'connecting',
  'ready',
  'degraded',
  'expired',
  'error',
] as const;
export type ImConnectionStatus = (typeof IM_CONNECTION_STATUSES)[number];

export const IM_PLATFORMS = ['telegram', 'wechat', 'slack', 'imessage'] as const;
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

export const imSlackConnectBodySchema = z
  .object({
    appToken: z.string().min(1).max(256),
    botToken: z.string().min(1).max(256),
  })
  .strict();
export type ImSlackConnectBody = z.infer<typeof imSlackConnectBodySchema>;

export const imImessageConnectBodySchema = z
  .object({ machineId: z.string().min(1).max(128) })
  .strict();
export type ImImessageConnectBody = z.infer<typeof imImessageConnectBodySchema>;

export const IM_INBOUND_TEXT_MAX_CHARS = 64 * 1024;
export const IM_INBOUND_FILES_LIMIT = 8;
export const IM_INBOUND_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const imInboundFileSchema = z.object({
  name: z.string().min(1).max(256),
  mimeType: z.string().max(256).nullable(),
  dataBase64: z
    .string()
    .max(Math.ceil((IM_INBOUND_FILE_MAX_BYTES / 3) * 4) + 64)
    .nullable(),
});
export type ImInboundFileBody = z.infer<typeof imInboundFileSchema>;

export const imInboundChatSchema = z.object({
  key: z.string().min(1).max(512),
  kind: z.enum(['direct', 'group']),
  title: z.string().max(512).nullable(),
});

export const imInboundSenderSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(512).nullable(),
});

export const imInboundMessageSchema = z.object({
  chat: imInboundChatSchema,
  sender: imInboundSenderSchema,
  text: z.string().max(IM_INBOUND_TEXT_MAX_CHARS),
  images: z.array(imInboundFileSchema).max(IM_INBOUND_FILES_LIMIT),
  files: z.array(imInboundFileSchema).max(IM_INBOUND_FILES_LIMIT),
  messageId: z.string().min(1).max(256),
  mentioned: z.boolean(),
});
export type ImInboundMessageBody = z.infer<typeof imInboundMessageSchema>;

export const imInboundActionSchema = z.object({
  chat: imInboundChatSchema,
  sender: imInboundSenderSchema,
  value: z.string().min(1).max(256),
  messageId: z.string().min(1).max(256),
});
export type ImInboundActionBody = z.infer<typeof imInboundActionSchema>;

export const machineImEventBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), message: imInboundMessageSchema }),
  z.object({ kind: z.literal('action'), action: imInboundActionSchema }),
  z.object({
    kind: z.literal('status'),
    status: z.enum(IM_CONNECTION_STATUSES),
    detail: z.string().max(1024).optional(),
  }),
  z.object({
    kind: z.literal('sent'),
    sendId: z.string().min(1).max(128),
    ok: z.boolean(),
    errorKind: z.enum(['permanent', 'drop', 'retry']).optional(),
    error: z.string().max(1024).optional(),
  }),
]);
export type MachineImEventBody = z.infer<typeof machineImEventBodySchema>;

export const imWechatLoginStartBodySchema = z
  .object({ connId: z.string().min(1).max(128).optional() })
  .strict();
export type ImWechatLoginStartBody = z.infer<typeof imWechatLoginStartBodySchema>;

export const imWechatLoginStartSchema = z.object({
  loginId: z.string().min(1),
  qr: z.string().optional(),
  expiresAt: z.number().int(),
});
export type ImWechatLoginStart = z.infer<typeof imWechatLoginStartSchema>;

export const imWechatLoginPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('done'), connection: imConnectionRecordSchema }),
]);
export type ImWechatLoginPoll = z.infer<typeof imWechatLoginPollSchema>;
