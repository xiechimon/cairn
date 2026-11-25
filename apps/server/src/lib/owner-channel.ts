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

export function ownerChannelFromEnv(env: NodeJS.ProcessEnv): OwnerChannel | undefined {
  return env[ENV_VARS.ownerChannel] === 'ipc' ? { key: null } : undefined;
}

export function listenOwnerChannel(channel: OwnerChannel | undefined): void {
  if (channel === undefined) return;
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (parentPort === undefined) {
    throw new Error(
      `${ENV_VARS.ownerChannel}=ipc is set but process.parentPort is absent — the channel key can only arrive over the desktop utility-process fork, so refusing to boot with every owner write closed`,
    );
  }
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

export function ownerChannelAdmits(
  c: Context,
  channel: OwnerChannel | undefined,
  accessExchange: boolean,
): Response | null {
  if (channel === undefined) return null;
  if ((c.get('pairedDeviceId') ?? null) !== null) return null;
  if (accessExchange && c.get('ownerIdentity')?.via === 'access') return null;
  if (channel.key === null) return c.json({ error: 'owner channel is not established' }, 503);
  const provided = c.req.header(OWNER_CHANNEL_HEADER);
  if (provided !== undefined && matchesChannelKey(channel.key, provided)) return null;
  return c.json({ error: 'owner channel required', code: 'owner-channel-required' }, 403);
}
