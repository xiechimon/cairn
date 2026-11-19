import { z } from 'zod';
import { modelSourceModelSchema } from './records/model-source.js';
import { subscriptionCheckSchema } from './subscription-check.js';

export const devinSubscriptionModelSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  family: z.string().max(256).optional(),
  costTier: z.string().max(256).optional(),
  costSummary: z.string().max(512).optional(),
  contextTokens: z.number().int().positive().optional(),
  supportsImages: z.boolean().optional(),
  isNew: z.boolean().optional(),
  isBeta: z.boolean().optional(),
  liveness: modelSourceModelSchema.shape.liveness,
});
export type DevinSubscriptionModel = z.infer<typeof devinSubscriptionModelSchema>;

export const devinSubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('devin-subscription'),
  label: z.string(),
  expiresAt: z.number().int().nullable(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  models: z.array(devinSubscriptionModelSchema).optional(),
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

export const renameDevinSubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    models: z.array(devinSubscriptionModelSchema).max(2000).optional(),
  })
  .refine((body) => body.label !== undefined || body.models !== undefined, {
    message: 'Nothing to update',
  });

export type PatchDevinSubscription = z.infer<typeof renameDevinSubscriptionSchema>;

export const devinSubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'failed']).optional(),
  check: subscriptionCheckSchema.optional(),
});

export type DevinSubscriptionVerifyResult = z.infer<typeof devinSubscriptionVerifyResultSchema>;
