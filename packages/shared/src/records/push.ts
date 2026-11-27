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

const ALLOWED_PUSH_SUFFIXES = ['.push.apple.com', '.notify.windows.com'] as const;

function isAllowedPushHost(hostname: string, hosts: ReadonlySet<string>): boolean {
  const lower = hostname.toLowerCase();
  for (const host of hosts) {
    if (lower === host.toLowerCase()) return true;
  }
  return ALLOWED_PUSH_SUFFIXES.some(
    (suffix) => lower.length > suffix.length && lower.endsWith(suffix),
  );
}

function isAllowedPushUrl(value: string, hosts: ReadonlySet<string>): boolean {
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }
  return isAllowedPushHost(hostname, hosts);
}

export function pushSubscriptionBodySchemaForHosts(hosts: ReadonlySet<string> = defaultPushHosts) {
  return z.object({
    endpoint: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .refine((value) => isAllowedPushUrl(value, hosts), {
        message: 'Unsupported push endpoint host',
      }),
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
