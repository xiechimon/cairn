import { timingSafeEqual } from 'node:crypto';
import {
  ENV_VARS,
  OWNER_CHANNEL_HEADER,
  OWNER_CHANNEL_MESSAGE,
  OWNER_CHANNEL_READY,
} from '@cairn/shared';
import type { Context } from 'hono';
import { sha256Hex } from './crypto.js';

export interface OwnerChannel {
  key: string | null;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: { data: unknown }) => void): void;
}

const DECISION_PATH_PATTERNS = [
  /^\/api\/actions\/proposals\/[^/]+\/answer$/,
  /^\/api\/teams\/[^/]+\/chief\/threads\/[^/]+\/questions\/[^/]+\/(?:answer|cancel)$/,
  /^\/api\/teams\/[^/]+\/im\/pairing-requests\/[^/]+\/(?:approve|reject)$/,
  /^\/api\/teams\/[^/]+\/api-keys$/,
  /^\/api\/remote\/pairing(?:\/[^/]+)?$/,
  /^\/api\/remote\/devices\/[^/]+$/,
  /^\/api\/remote\/(?:tailnet|tailscale)$/,
  /^\/api\/machine\/enroll\/confirm$/,
  /^\/api\/machines\/[^/]+(?:\/revoke)?$/,
  /^\/api\/machines\/[^/]+\/phones(?:\/[^/]+(?:\/(?:pair|handback))?)?$/,
];

export function isOwnerDecisionPath(pathname: string): boolean {
  return DECISION_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function ownerChannelFromEnv(env: NodeJS.ProcessEnv): OwnerChannel | undefined {
  return env[ENV_VARS.ownerChannel] === 'ipc' ? { key: null } : undefined;
}

export function listenOwnerChannel(channel: OwnerChannel | undefined): void {
  if (channel === undefined) return;
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (parentPort === undefined) return;
  parentPort.on('message', (message) => {
    const data = message.data;
    if (
      data !== null &&
      typeof data === 'object' &&
      (data as { type?: unknown }).type === OWNER_CHANNEL_MESSAGE &&
      typeof (data as { key?: unknown }).key === 'string'
    ) {
      channel.key = (data as { key: string }).key;
    }
  });
  parentPort.postMessage({ type: OWNER_CHANNEL_READY });
}

function matchesChannelKey(expected: string, provided: string): boolean {
  const left = Buffer.from(sha256Hex(expected));
  const right = Buffer.from(sha256Hex(provided));
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function ownerChannelAdmits(c: Context, channel: OwnerChannel | undefined): Response | null {
  if (channel === undefined) return null;
  if ((c.get('pairedDeviceId') ?? null) !== null) return null;
  if (c.get('ownerIdentity')?.via === 'access') return null;
  if (channel.key === null) return c.json({ error: 'owner channel is not established' }, 503);
  const provided = c.req.header(OWNER_CHANNEL_HEADER);
  if (provided !== undefined && matchesChannelKey(channel.key, provided)) return null;
  return c.json({ error: 'owner channel required' }, 403);
}
