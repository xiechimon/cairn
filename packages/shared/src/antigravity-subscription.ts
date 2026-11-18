import { z } from 'zod';

export const ANTIGRAVITY_TOKEN_REGEX = /^[A-Za-z0-9._~$+/=-]{16,4096}$/;

export const antigravitySubscriptionModelSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
});

export type AntigravitySubscriptionModel = z.infer<typeof antigravitySubscriptionModelSchema>;

export const antigravitySubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('antigravity-subscription'),
  label: z.string(),
  hasToken: z.boolean(),
  expiresAt: z.number().int().nullable(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  models: z.array(antigravitySubscriptionModelSchema).optional(),
  createdAt: z.number().int(),
});

export type AntigravitySubscription = z.infer<typeof antigravitySubscriptionSchema>;

export const createAntigravitySubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  token: z
    .string()
    .trim()
    .regex(ANTIGRAVITY_TOKEN_REGEX, 'Invalid credential format')
    .nullable()
    .optional(),
  expiresAt: z.number().int().positive().nullable().optional(),
});

export type CreateAntigravitySubscription = z.infer<typeof createAntigravitySubscriptionSchema>;

export const renameAntigravitySubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    models: z.array(antigravitySubscriptionModelSchema).max(2000).optional(),
  })
  .refine((body) => body.label !== undefined || body.models !== undefined, {
    message: 'Nothing to update',
  });

export type PatchAntigravitySubscription = z.infer<typeof renameAntigravitySubscriptionSchema>;

export const antigravitySubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'failed', 'missing_local_login']).optional(),
});

export type AntigravitySubscriptionVerifyResult = z.infer<
  typeof antigravitySubscriptionVerifyResultSchema
>;
