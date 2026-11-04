import { z } from 'zod';

export const claudeSubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('claude-subscription'),
  label: z.string(),
  expiresAt: z.number().int().nullable(),
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
