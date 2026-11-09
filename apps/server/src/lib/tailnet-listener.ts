import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import type { Context, Hono } from 'hono';

const LISTENER_ENV_KEY = 'cairnListener';
const TAILNET_LISTENER = 'tailnet';
const TAILNET_SCHEME = 'https';
const IDENTITY_LOGIN_HEADER = 'tailscale-user-login';
const IDENTITY_NAME_HEADER = 'tailscale-user-name';
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const MAX_IDENTITY_CHARS = 254;
const SOCKET_MODE = 0o600;

export interface TailnetIdentity {
  login: string;
  name: string | null;
}

export interface TailnetOwnerPolicy {
  ownerLogin: string | null;
  selfTagged: boolean;
  allowedLogins: readonly string[];
  selfAddresses: readonly string[] | null;
}

interface TailnetListenerEnv {
  kind: typeof TAILNET_LISTENER;
  dnsName: () => string | null;
  ownerPolicy: () => TailnetOwnerPolicy;
}

export interface TailnetListener {
  server: Server;
  close(): Promise<void>;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function identityValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (value === undefined || value === '') return null;
  if (value.length > MAX_IDENTITY_CHARS || hasControlCharacter(value)) return null;
  return value;
}

export function tailnetListenerOf(c: Context): TailnetListenerEnv | null {
  const env = c.env as Record<string, unknown> | undefined;
  const listener = env?.[LISTENER_ENV_KEY] as TailnetListenerEnv | undefined;
  return listener?.kind === TAILNET_LISTENER ? listener : null;
}

export function tailnetOriginOf(c: Context): string | null {
  const listener = tailnetListenerOf(c);
  if (listener === null) return null;
  const dnsName = listener.dnsName();
  const host = dnsName !== null && dnsName !== '' ? dnsName : new URL(c.req.url).host;
  return `${TAILNET_SCHEME}://${host}`;
}

export function tailnetIdentityOf(c: Context): TailnetIdentity | null {
  if (tailnetListenerOf(c) === null || c.req.header('tailscale-funnel-request') !== undefined)
    return null;
  const login = identityValue(c.req.header(IDENTITY_LOGIN_HEADER));
  if (login === null) return null;
  return { login, name: identityValue(c.req.header(IDENTITY_NAME_HEADER)) };
}

export function tailnetOwnerIdentityOf(c: Context): TailnetIdentity | null {
  const listener = tailnetListenerOf(c);
  if (listener === null) return null;
  const identity = tailnetIdentityOf(c);
  if (identity === null) return null;
  const policy = listener.ownerPolicy();
  const source = c.req.header(FORWARDED_FOR_HEADER)?.split(',')[0]?.trim();
  if (
    source !== undefined &&
    (policy.selfAddresses === null || policy.selfAddresses.includes(source))
  )
    return null;
  const allowed =
    !policy.selfTagged && policy.ownerLogin !== null
      ? identity.login === policy.ownerLogin
      : policy.allowedLogins.includes(identity.login);
  return allowed ? identity : null;
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  let isSocket: boolean;
  try {
    const info = lstatSync(socketPath);
    isSocket = info.isSocket();
    if (process.getuid !== undefined && info.uid !== process.getuid()) {
      throw new Error(`${socketPath} is owned by another user`);
    }
    if (isSocket && (info.mode & 0o777) !== SOCKET_MODE) {
      throw new Error(`${socketPath} must have mode 0600`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!isSocket) throw new Error(`${socketPath} exists and is not a socket`);
  const active = await new Promise<boolean>((resolve, reject) => {
    const probe = createConnection(socketPath);
    probe.setTimeout(1_000, () => probe.destroy(new Error('tailnet socket probe timed out')));
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false);
      else reject(error);
    });
  });
  if (active) throw new Error(`${socketPath} is already in use`);
  unlinkSync(socketPath);
}

export async function listenOnTailnetSocket(
  app: Hono,
  socketPath: string,
  dnsName: () => string | null = () => null,
  ownerPolicy: () => TailnetOwnerPolicy = () => ({
    ownerLogin: null,
    selfTagged: false,
    allowedLogins: [],
    selfAddresses: [],
  }),
): Promise<TailnetListener> {
  const parent = lstatSync(dirname(socketPath));
  if (
    !parent.isDirectory() ||
    (parent.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && parent.uid !== process.getuid())
  ) {
    throw new Error('tailnet socket requires a private owner directory');
  }
  await removeStaleSocket(socketPath);
  const server = createServer(
    getRequestListener((request, env) =>
      app.fetch(request, {
        ...env,
        [LISTENER_ENV_KEY]: {
          kind: TAILNET_LISTENER,
          dnsName,
          ownerPolicy,
        } satisfies TailnetListenerEnv,
      }),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    chmodSync(socketPath, SOCKET_MODE);
    const info = lstatSync(socketPath);
    if (
      !info.isSocket() ||
      (info.mode & 0o777) !== SOCKET_MODE ||
      (process.getuid !== undefined && info.uid !== process.getuid())
    ) {
      throw new Error('tailnet socket must be owner-only with mode 0600');
    }
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
