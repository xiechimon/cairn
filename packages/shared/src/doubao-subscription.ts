import { z } from 'zod';
import { modelSourceModelSchema } from './records/model-source.js';
import { subscriptionCheckSchema } from './subscription-check.js';

export const DOUBAO_MODEL_NAME_MAX_LENGTH = 256;

export const doubaoSubscriptionModelSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(DOUBAO_MODEL_NAME_MAX_LENGTH),
  thinkingLevels: modelSourceModelSchema.shape.thinkingLevels,
  thinkingDefault: modelSourceModelSchema.shape.thinkingDefault,
});

export type DoubaoSubscriptionModel = z.infer<typeof doubaoSubscriptionModelSchema>;

export const doubaoSubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('doubao-subscription'),
  label: z.string(),
  runnerId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  models: z.array(doubaoSubscriptionModelSchema).optional(),
  createdAt: z.number().int(),
});

export type DoubaoSubscription = z.infer<typeof doubaoSubscriptionSchema>;

export const createDoubaoSubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  runnerId: z.string().min(1).max(256).nullable().optional(),
});

export type CreateDoubaoSubscription = z.infer<typeof createDoubaoSubscriptionSchema>;

export const DOUBAO_QR_MAX_BYTES = 64 * 1024;

export const DOUBAO_LOGIN_STATUSES = [
  'installing',
  'starting',
  'qr',
  'scanned',
  'verifying',
  'succeeded',
  'expired',
  'refused',
  'cancelled',
  'failed',
] as const;
export type DoubaoLoginStatus = (typeof DOUBAO_LOGIN_STATUSES)[number];
export const doubaoLoginStatusSchema = z.enum(DOUBAO_LOGIN_STATUSES);

export const DOUBAO_LOGIN_REASONS = [
  'unsupported_platform',
  'install_failed',
  'keychain_locked',
  'unsupported_account',
  'refused',
  'expired',
  'offline',
  'unknown',
] as const;
export type DoubaoLoginReason = (typeof DOUBAO_LOGIN_REASONS)[number];
export const doubaoLoginReasonSchema = z.enum(DOUBAO_LOGIN_REASONS);

export const doubaoLoginSessionSchema = z.object({
  loginId: z.string().min(1).max(64),
  machineId: z.string().min(1).max(128),
  machineName: z.string(),
  status: doubaoLoginStatusSchema,
  qrPngBase64: z.string().max(100_000).optional(),
  revision: z.number().int().nonnegative(),
  reason: doubaoLoginReasonSchema.optional(),
  detail: z.string().max(500).optional(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type DoubaoLoginSession = z.infer<typeof doubaoLoginSessionSchema>;

export const startDoubaoLoginBodySchema = z.object({
  force: z.boolean().optional(),
  logoutFirst: z.boolean().optional(),
});
export type StartDoubaoLoginBody = z.infer<typeof startDoubaoLoginBodySchema>;

export const patchDoubaoSubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    models: z.array(doubaoSubscriptionModelSchema).max(2000).optional(),
    runnerId: z.string().min(1).max(256).nullable().optional(),
  })
  .refine(
    (body) => body.label !== undefined || body.models !== undefined || body.runnerId !== undefined,
    { message: 'Nothing to update' },
  );

export type PatchDoubaoSubscription = z.infer<typeof patchDoubaoSubscriptionSchema>;

export const doubaoSubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'failed', 'missing_local_login']).optional(),
  runnerName: z.string().nullable().optional(),
  check: subscriptionCheckSchema.optional(),
});

export type DoubaoSubscriptionVerifyResult = z.infer<typeof doubaoSubscriptionVerifyResultSchema>;
