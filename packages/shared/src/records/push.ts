import { z } from 'zod';

export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
});
export type PushSubscriptionKeys = z.infer<typeof pushSubscriptionKeysSchema>;

const defaultPushHosts: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);

export function pushSubscriptionBodySchemaForHosts(hosts: ReadonlySet<string> = defaultPushHosts) {
  const exactHosts = [...hosts].map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const hostname = new RegExp(
    `^(?:${exactHosts.join('|')}|.+\\.push\\.apple\\.com|.+\\.notify\\.windows\\.com)$`,
    'i',
  );
  return z.object({
    endpoint: z.url({ protocol: /^https$/, hostname }).max(2048),
    keys: pushSubscriptionKeysSchema,
    expirationTime: z.number().int().nullable().optional(),
  });
}

export const pushSubscriptionBodySchema = pushSubscriptionBodySchemaForHosts();
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;

export const pushSubscriptionDeleteBodySchema = z.object({
  endpoint: z.string().min(1).max(2048),
});
export type PushSubscriptionDeleteBody = z.infer<typeof pushSubscriptionDeleteBodySchema>;

export const pushPublicKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;
