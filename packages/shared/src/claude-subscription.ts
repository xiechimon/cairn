import { z } from 'zod';
import { CLAUDE_MODEL_ID_PATTERN } from './records/model-source.js';
import { subscriptionCheckSchema } from './subscription-check.js';

export const claudeSubscriptionModelSchema = z.strictObject({
  id: z.string().min(1).max(256).regex(CLAUDE_MODEL_ID_PATTERN, 'Invalid model id'),
  name: z.string().min(1).max(256),
});

export type ClaudeSubscriptionModel = z.infer<typeof claudeSubscriptionModelSchema>;

export const claudeSubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('claude-subscription'),
  label: z.string(),
  expiresAt: z.number().int().nullable(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  models: z.array(claudeSubscriptionModelSchema).nullable().optional(),
  createdAt: z.number().int(),
});

export type ClaudeSubscription = z.infer<typeof claudeSubscriptionSchema>;

export const createClaudeSubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  token: z
    .string()
    .trim()
    .min(64, 'Invalid credential format')
    .max(4096, 'Invalid credential format')
    .regex(/^sk-ant-oat01-[A-Za-z0-9._~-]+$/, 'Invalid credential format'),
  expiresAt: z.number().int().positive().nullable().optional(),
});

export type CreateClaudeSubscription = z.infer<typeof createClaudeSubscriptionSchema>;

export const renameClaudeSubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    models: z.array(claudeSubscriptionModelSchema).max(2000).nullable().optional(),
    token: createClaudeSubscriptionSchema.shape.token.optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.models !== undefined ||
      body.token !== undefined ||
      body.expiresAt !== undefined,
    { message: 'Nothing to update' },
  );

export type PatchClaudeSubscription = z.infer<typeof renameClaudeSubscriptionSchema>;

export const claudeSubscriptionTestSchema = z.object({
  model: z.string().trim().max(256).regex(CLAUDE_MODEL_ID_PATTERN, 'Invalid model id'),
});

export const claudeSubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'quota', 'failed']).optional(),
  check: subscriptionCheckSchema.optional(),
});

export type ClaudeSubscriptionVerifyResult = z.infer<typeof claudeSubscriptionVerifyResultSchema>;
