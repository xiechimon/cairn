import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import type { Context, Hono } from 'hono';

const LISTENER_ENV_KEY = 'cairnListener';
const TAILNET_LISTENER = 'tailnet';
const TAILNET_SCHEME = 'https';
const IDENTITY_LOGIN_HEADER = 'tailscale-user-login';
const IDENTITY_NAME_HEADER = 'tailscale-user-name';
const MAX_IDENTITY_CHARS = 254;
const SOCKET_MODE = 0o600;

export interface TailnetIdentity {
  login: string;
  name: string | null;
}

interface TailnetListenerEnv {
  kind: typeof TAILNET_LISTENER;
  dnsName: () => string | null;
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

function tailnetListenerOf(c: Context): TailnetListenerEnv | null {
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
  if (tailnetListenerOf(c) === null) return null;
  const login = identityValue(c.req.header(IDENTITY_LOGIN_HEADER));
  if (login === null) return null;
  return { login, name: identityValue(c.req.header(IDENTITY_NAME_HEADER)) };
}

function removeStaleSocket(socketPath: string): void {
  let isSocket: boolean;
  try {
    isSocket = lstatSync(socketPath).isSocket();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!isSocket) throw new Error(`${socketPath} exists and is not a socket`);
  unlinkSync(socketPath);
}

export async function listenOnTailnetSocket(
  app: Hono,
  socketPath: string,
  dnsName: () => string | null = () => null,
): Promise<TailnetListener> {
  removeStaleSocket(socketPath);
  const server = createServer(
    getRequestListener((request, env) =>
      app.fetch(request, {
        ...env,
        [LISTENER_ENV_KEY]: { kind: TAILNET_LISTENER, dnsName } satisfies TailnetListenerEnv,
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
  chmodSync(socketPath, SOCKET_MODE);
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
