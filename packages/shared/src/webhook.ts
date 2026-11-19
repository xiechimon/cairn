import { z } from 'zod';

export const WEBHOOK_TRIGGER_LABEL = 'ready-for-agent';

export const GITHUB_WEBHOOK_DELIVERY_LIMIT = 50;

export const githubIssuesEventSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
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

export const githubWebhookMintSchema = z.object({
  webhookUrl: z.string(),
  token: z.string(),
  masked: z.string(),
});
export type GithubWebhookMint = z.infer<typeof githubWebhookMintSchema>;
