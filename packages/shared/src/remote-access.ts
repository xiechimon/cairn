import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';

export const REMOTE_DESCRIPTOR_VERSION = 1;
export const PAIRING_CODE_TTL_MS = 300_000;
export const PAIRING_CODE_CAP = 20;
export const PAIRED_DEVICE_CAP = 50;
export const DEVICE_NAME_MAX_CHARS = 80;
export const PAIR_FRAGMENT_KEY = 'pair';
export const PAIR_FRAGMENT_ENVIRONMENT_KEY = 'env';
export const DEVICE_TOKEN_PREFIX = 'cairn_dev_';

export const remoteDescriptorSchema = z
  .object({
    environmentId: z.string().min(1),
    version: z.literal(REMOTE_DESCRIPTOR_VERSION),
  })
  .strict();
export type RemoteDescriptor = z.infer<typeof remoteDescriptorSchema>;

export const remoteRouteKindSchema = z.enum(['lan', 'tailnet']);
export type RemoteRouteKind = z.infer<typeof remoteRouteKindSchema>;

export const remoteRouteSchema = z.object({
  kind: remoteRouteKindSchema,
  url: z.string().url(),
});
export type RemoteRoute = z.infer<typeof remoteRouteSchema>;

export const remoteRoutesResponseSchema = z.object({
  environmentId: z.string().min(1),
  routes: z.array(remoteRouteSchema),
  tailnet: z.object({
    state: z.enum(['off', 'starting', 'needs-login', 'ready', 'restarting', 'failed', 'stopped']),
    dnsName: z.string().nullable(),
    ips: z.array(z.string()),
    authUrl: z.string().nullable(),
  }),
});
export type RemoteRoutesResponse = z.infer<typeof remoteRoutesResponseSchema>;

export const deviceNameSchema = z.string().trim().min(1).max(DEVICE_NAME_MAX_CHARS);

export const pairingCodeResponseSchema = z.object({
  code: z.string().min(1),
  expiresAt: epochMs,
  environmentId: z.string().min(1),
});
export type PairingCodeResponse = z.infer<typeof pairingCodeResponseSchema>;

export const pairBodySchema = z
  .object({
    code: z.string().min(1).max(256),
    name: deviceNameSchema,
  })
  .strict();
export type PairBody = z.infer<typeof pairBodySchema>;

export const pairResponseSchema = z.object({
  token: z.string().min(1),
  deviceId: recordId,
  environmentId: z.string().min(1),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const pairedDeviceSchema = z.object({
  id: recordId,
  name: z.string(),
  masked: z.string(),
  createdAt: epochMs,
  lastSeenAt: epochMs.nullable(),
});
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

export function maskDeviceToken(plaintext: string): string {
  return `${plaintext.slice(0, DEVICE_TOKEN_PREFIX.length + 6)}…`;
}

export function pairingLink(input: {
  origin: string;
  code: string;
  environmentId: string;
}): string {
  const fragment = new URLSearchParams({
    [PAIR_FRAGMENT_KEY]: input.code,
    [PAIR_FRAGMENT_ENVIRONMENT_KEY]: input.environmentId,
  });
  return `${input.origin}/app#${fragment.toString()}`;
}

export function parsePairFragment(hash: string): { code: string; environmentId: string } | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const code = params.get(PAIR_FRAGMENT_KEY);
  const environmentId = params.get(PAIR_FRAGMENT_ENVIRONMENT_KEY);
  if (code === null || code === '' || environmentId === null || environmentId === '') return null;
  return { code, environmentId };
}
