import { z } from 'zod';

export const devinSubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('devin-subscription'),
  label: z.string(),
  expiresAt: z.number().int().nullable(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  createdAt: z.number().int(),
});

export type DevinSubscription = z.infer<typeof devinSubscriptionSchema>;

export const createDevinSubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  token: z
    .string()
    .trim()
    .min(16, 'Invalid credential format')
    .max(4096, 'Invalid credential format')
    .regex(/^[A-Za-z0-9._~$+/=-]+$/, 'Invalid credential format'),
  expiresAt: z.number().int().positive().nullable().optional(),
});

export type CreateDevinSubscription = z.infer<typeof createDevinSubscriptionSchema>;

export const renameDevinSubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
});

export const devinSubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'failed']).optional(),
});

export type DevinSubscriptionVerifyResult = z.infer<typeof devinSubscriptionVerifyResultSchema>;
