import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';

export const REMOTE_DESCRIPTOR_VERSION = 1;
export const PAIRING_CODE_TTL_MS = 300_000;
export const PAIRING_CODE_CAP = 20;
export const PAIRED_DEVICE_CAP = 50;
export const DEVICE_NAME_MAX_CHARS = 80;
export const PAIRING_REQUEST_CLAIM_GRACE_MS = 120_000;
export const PAIRING_REQUEST_CAP = 20;
export const PAIRING_REQUEST_RATE_CAP = 20;
export const PAIRING_REQUEST_RATE_WINDOW_MS = 600_000;
export const PAIR_FRAGMENT_KEY = 'pair';
export const PAIR_FRAGMENT_ENVIRONMENT_KEY = 'env';
export const DEVICE_TOKEN_PREFIX = 'cairn_dev_';
export const BROWSER_AUTH_HEADER = 'x-cairn-browser-auth';
export const BROWSER_SESSION_PATH = '/api/auth/session';

export function isOpenRemotePath(pathname: string): boolean {
  return (
    pathname === '/api/remote/descriptor' ||
    pathname === '/api/remote/pair' ||
    pathname === '/api/remote/pair/request' ||
    pathname === '/api/remote/pair/claim'
  );
}

export function isBrowserAuthExempt(pathname: string): boolean {
  if (pathname.includes('%')) return false;
  return (
    !pathname.startsWith('/api/') ||
    (pathname !== '/api/machine/enroll/confirm' && pathname.startsWith('/api/machine/')) ||
    pathname === '/api/machine' ||
    pathname.startsWith('/api/webhook/') ||
    pathname === '/api/mcp' ||
    pathname === '/api/oauth/callback' ||
    pathname === '/api/remote/account/callback' ||
    pathname === '/api/auth/access' ||
    isOpenRemotePath(pathname)
  );
}

export const remoteDescriptorSchema = z
  .object({
    environmentId: z.string().min(1),
    version: z.literal(REMOTE_DESCRIPTOR_VERSION),
  })
  .strict();
export type RemoteDescriptor = z.infer<typeof remoteDescriptorSchema>;

export const remoteRouteKindSchema = z.enum(['lan', 'tailnet', 'tunnel']);
export type RemoteRouteKind = z.infer<typeof remoteRouteKindSchema>;

export const remoteRouteSchema = z.object({
  kind: remoteRouteKindSchema,
  url: z.string().url(),
});
export type RemoteRoute = z.infer<typeof remoteRouteSchema>;

export const tailnetErrorKindSchema = z.enum([
  'missing-binary',
  'auth-off',
  'unavailable',
  'crashed',
]);
export type TailnetErrorKind = z.infer<typeof tailnetErrorKindSchema>;

export const tailnetAccessSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['off', 'starting', 'needs-login', 'ready', 'restarting', 'failed', 'stopped']),
  dnsName: z.string().nullable(),
  ips: z.array(z.string()),
  authUrl: z.string().nullable(),
  error: tailnetErrorKindSchema.nullable(),
});
export type TailnetAccess = z.infer<typeof tailnetAccessSchema>;

export const tailnetSetBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type TailnetSetBody = z.infer<typeof tailnetSetBodySchema>;

export const tunnelErrorKindSchema = z.enum([
  'auth-off',
  'invalid-relay',
  'unreachable',
  'rejected',
]);
export type TunnelErrorKind = z.infer<typeof tunnelErrorKindSchema>;

export const relayAccountSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable().optional(),
});
export type RelayAccount = z.infer<typeof relayAccountSchema>;

export const tunnelAccessSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['off', 'connecting', 'ready', 'reconnecting', 'failed', 'stopped']),
  url: z.string().nullable(),
  relayUrl: z.string().nullable(),
  error: tunnelErrorKindSchema.nullable(),
  account: relayAccountSchema.nullable().optional(),
});
export type TunnelAccess = z.infer<typeof tunnelAccessSchema>;

export const tunnelSetBodySchema = z
  .object({
    enabled: z.boolean(),
    relayUrl: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type TunnelSetBody = z.infer<typeof tunnelSetBodySchema>;

export const relayOAuthStartBodySchema = z
  .object({
    relayUrl: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type RelayOAuthStartBody = z.infer<typeof relayOAuthStartBodySchema>;

export const relayOAuthStartResponseSchema = z.object({
  loginUrl: z.string().url(),
});
export type RelayOAuthStartResponse = z.infer<typeof relayOAuthStartResponseSchema>;

export const relayDirectoryDeviceSchema = z.object({
  subdomain: z.string().min(1),
  name: z.string().min(1),
  os: z.string().min(1),
  ownerEmail: z.string().email(),
  online: z.boolean(),
  url: z.string().url(),
  lastSeenAt: epochMs,
  role: z.enum(['owner', 'collaborator']),
});
export type RelayDirectoryDevice = z.infer<typeof relayDirectoryDeviceSchema>;

export const relayDirectoryResponseSchema = z.object({
  account: relayAccountSchema.nullable(),
  selfSubdomain: z.string().nullable(),
  ownDevices: z.array(relayDirectoryDeviceSchema),
  sharedDevices: z.array(relayDirectoryDeviceSchema),
});
export type RelayDirectoryResponse = z.infer<typeof relayDirectoryResponseSchema>;

export const relayShareBodySchema = z
  .object({
    targetEmail: z.string().trim().email().max(120),
    role: z.enum(['owner', 'collaborator']).optional(),
  })
  .strict();
export type RelayShareBody = z.infer<typeof relayShareBodySchema>;

export const feedbackSubmitBodySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    route: z.string().trim().max(200).optional(),
    errorSummary: z.string().trim().max(400).optional(),
    includeLogs: z.boolean().optional(),
  })
  .strict();
export type FeedbackSubmitBody = z.infer<typeof feedbackSubmitBodySchema>;

export const feedbackSubmitResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string().min(1),
  issueUrl: z.string().url().nullable().optional(),
});
export type FeedbackSubmitResponse = z.infer<typeof feedbackSubmitResponseSchema>;

export const remoteRoutesResponseSchema = z.object({
  environmentId: z.string().min(1),
  routes: z.array(remoteRouteSchema),
  tailnet: tailnetAccessSchema,
  tunnel: tunnelAccessSchema.optional(),
});
export type RemoteRoutesResponse = z.infer<typeof remoteRoutesResponseSchema>;

export const tailscaleAccessStateSchema = z.enum([
  'not-installed',
  'not-connected',
  'needs-operator',
  'needs-https',
  'occupied',
  'off',
  'verifying',
  'unreachable',
  'ready',
]);
export type TailscaleAccessState = z.infer<typeof tailscaleAccessStateSchema>;

export const tailscaleAccessSchema = z.object({
  state: tailscaleAccessStateSchema,
  url: z.string().url().nullable(),
  consentUrl: z.string().url().nullable(),
});
export type TailscaleAccess = z.infer<typeof tailscaleAccessSchema>;

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
    environmentId: z.string().min(1).optional(),
  })
  .strict();
export type PairBody = z.infer<typeof pairBodySchema>;

export const pairResponseSchema = z.object({
  token: z.string().min(1),
  deviceId: recordId,
  environmentId: z.string().min(1),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const pairRequestSourceSchema = z.enum(['loopback', 'lan', 'tailnet', 'public', 'unknown']);
export type PairRequestSource = z.infer<typeof pairRequestSourceSchema>;

export const pairRequestBodySchema = z
  .object({
    name: deviceNameSchema,
    detail: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type PairRequestBody = z.infer<typeof pairRequestBodySchema>;

export const pairRequestResponseSchema = z.object({
  id: recordId,
  secret: z.string().min(1),
  code: z.string().min(1),
  expiresAt: epochMs,
});
export type PairRequestResponse = z.infer<typeof pairRequestResponseSchema>;

export const pairClaimBodySchema = z
  .object({
    id: z.string().min(1).max(128),
    secret: z.string().min(1).max(256),
  })
  .strict();
export type PairClaimBody = z.infer<typeof pairClaimBodySchema>;

export const pairClaimResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('approved'),
    token: z.string().min(1),
    deviceId: recordId,
    environmentId: z.string().min(1),
  }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
]);
export type PairClaimResponse = z.infer<typeof pairClaimResponseSchema>;

export const pairingRequestViewSchema = z.object({
  id: recordId,
  code: z.string(),
  name: z.string(),
  detail: z.string().nullable(),
  source: pairRequestSourceSchema,
  createdAt: epochMs,
  expiresAt: epochMs,
});
export type PairingRequestView = z.infer<typeof pairingRequestViewSchema>;

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
