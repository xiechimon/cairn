import { z } from 'zod';

export const GITHUB_WEBHOOK_DELIVERY_LIMIT = 50;

export const webhookReceiverResponseSchema = z.object({
  result: z.enum(['duplicate', 'ignored']),
  deliveryId: z.string(),
  detail: z.string().optional(),
});
export type WebhookReceiverResponse = z.infer<typeof webhookReceiverResponseSchema>;

export const githubWebhookMintSchema = z.object({
  webhookUrl: z.string(),
  token: z.string(),
  masked: z.string(),
});
export type GithubWebhookMint = z.infer<typeof githubWebhookMintSchema>;
