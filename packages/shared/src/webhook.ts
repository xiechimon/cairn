import { z } from 'zod';

export const WEBHOOK_TRIGGER_LABEL = 'cairn';

export const WEBHOOK_DEDUP_WINDOW_MS = 60_000;

export const githubIssuesEventSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
  }),
  label: z
    .object({
      name: z.string(),
    })
    .optional(),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  sender: z
    .object({
      login: z.string(),
    })
    .nullish(),
});
export type GithubIssuesEvent = z.infer<typeof githubIssuesEventSchema>;

export const webhookReceiverResponseSchema = z.object({
  result: z.enum(['created', 'duplicate', 'ignored', 'misconfigured']),
  deliveryId: z.string(),
  todoId: z.string().optional(),
  threadId: z.string().optional(),
  detail: z.string().optional(),
});
export type WebhookReceiverResponse = z.infer<typeof webhookReceiverResponseSchema>;
