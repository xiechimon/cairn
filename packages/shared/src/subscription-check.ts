import { z } from 'zod';

export const subscriptionCheckSchema = z.object({
  at: z.number().int(),
  ok: z.boolean(),
  reason: z.string().nullable(),
  check: z.enum(['model-request', 'sign-in']),
  command: z.string(),
  via: z.enum(['cli', 'api']).optional(),
  model: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
});

export type SubscriptionCheck = z.infer<typeof subscriptionCheckSchema>;
