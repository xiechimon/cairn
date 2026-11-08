import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { FetchLike } from '../src/lib/github.js';

const LOCAL_HOSTS = new Set([
  'localhost',
  '::1',
  '[::1]',
  ...Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? []).flatMap(({ address }) => [address, `[${address}]`]),
  ),
]);
const unstubbedCalls: string[] = [];

function isLocal(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.startsWith('127.');
}

function callSite(): string {
  const frame = new Error().stack?.split('\n').find((line) => line.includes('/apps/server/src/'));
  return frame === undefined ? '' : ` (${frame.trim()})`;
}

function unstubbed(call: string): Error {
  unstubbedCalls.push(`${call}${callSite()}`);
  return new Error(
    `unstubbed network call from a server test: ${call}; pass the test an explicit stub`,
  );
}

export function takeUnstubbedCalls(): string[] {
  return unstubbedCalls.splice(0);
}

export const rejectingGithubFetch: FetchLike = async (input, init) => {
  throw unstubbed(`githubFetch ${init?.method ?? 'GET'} ${String(input)}`);
};

function requestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  const raw = input instanceof Request ? input.url : String(input);
  return URL.canParse(raw) ? new URL(raw) : null;
}

function socketHost(args: unknown[]): string | null {
  const [first, second] = args;
  if (Array.isArray(first)) return socketHost(first);
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: unknown; path?: unknown };
    if (typeof options.path === 'string') return null;
    return typeof options.host === 'string' ? options.host : 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return typeof second === 'string' ? second : 'localhost';
}

export function installNetworkGuard(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
    if (url === null || !/^(https?|wss?):$/.test(url.protocol) || isLocal(url.hostname))
      return realFetch(input, init);
    return Promise.reject(unstubbed(`fetch ${init?.method ?? 'GET'} ${url.href}`));
  };
  const realConnect = Socket.prototype.connect as (this: Socket, ...args: unknown[]) => Socket;
  const guardedConnect = function (this: Socket, ...args: unknown[]): Socket {
    const host = socketHost(args);
    if (host === null || isLocal(host)) return realConnect.apply(this, args);
    const error = unstubbed(`socket connect ${host}`);
    process.nextTick(() => this.destroy(error));
    return this;
  };
  Socket.prototype.connect = guardedConnect as typeof Socket.prototype.connect;
}
