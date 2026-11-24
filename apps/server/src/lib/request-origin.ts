import { TLSSocket } from 'node:tls';
import type { PairRequestSource } from '@cairn/shared';
import type { Http2Bindings, HttpBindings } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { forwardedOrigin } from './forwarded-origin.js';
import {
  hasTailscaleIdentityHeaders,
  tailnetIdentityOf,
  tailnetListenerOf,
  tailnetOriginOf,
} from './tailnet-listener.js';

export const TUNNEL_ORIGIN_ENV_KEY = Symbol.for('cairn.tunnelOrigin');

type NodeBindings = HttpBindings | Http2Bindings;

const LOOPBACK_PEER_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_FORWARDING_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
  'x-real-ip',
  'via',
  'cf-connecting-ip',
] as const;

function peerAddressOf(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}

export function isLoopbackPeer(c: Context): boolean {
  const peerAddress = peerAddressOf(c);
  return peerAddress !== undefined && LOOPBACK_PEER_ADDRESSES.has(peerAddress);
}

export function isDirectLoopbackPeer(c: Context): boolean {
  return (
    isLoopbackPeer(c) &&
    tailnetListenerOf(c) === null &&
    !hasTailscaleIdentityHeaders(c) &&
    PROXY_FORWARDING_HEADERS.every((header) => c.req.header(header) === undefined)
  );
}

const TAILSCALE_PEER = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/;
const LAN_PEER =
  /^(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|f[cd][0-9a-f]*:|fe80:)/i;

export function pairRequestPeerOf(c: Context): { source: PairRequestSource; peer: string } {
  const tailnetIdentity = tailnetIdentityOf(c);
  let address = peerAddressOf(c);
  if (address?.startsWith('::ffff:')) address = address.slice('::ffff:'.length);
  const peer = tailnetIdentity?.login ?? address ?? 'unknown';
  if (tailnetOriginOf(c) !== null) return { source: 'tailnet', peer };
  if (address === undefined) return { source: 'unknown', peer };
  if (LOOPBACK_PEER_ADDRESSES.has(address)) return { source: 'loopback', peer };
  if (TAILSCALE_PEER.test(address)) return { source: 'tailnet', peer };
  if (LAN_PEER.test(address)) return { source: 'lan', peer };
  return { source: 'public', peer };
}

export function requestOrigin(c: Context): string {
  const tailnet = tailnetOriginOf(c);
  if (tailnet !== null) return new URL(tailnet).origin;
  const tunnelOrigin = (c.env as Record<symbol, unknown> | undefined)?.[TUNNEL_ORIGIN_ENV_KEY];
  if (typeof tunnelOrigin === 'string') return new URL(tunnelOrigin).origin;

  const requestUrl = new URL(c.req.url);
  const env = c.env as (Partial<NodeBindings> & { server?: NodeBindings }) | undefined;
  const socket = (env?.server ?? env)?.incoming?.socket;
  const protocol =
    socket === undefined
      ? requestUrl.protocol
      : socket instanceof TLSSocket && socket.encrypted
        ? 'https:'
        : 'http:';
  const host = c.req.header('host') ?? requestUrl.host;
  const url = URL.parse(`${protocol}//${host}`) ?? requestUrl;
  return forwardedOrigin({
    url: url.href,
    loopbackPeer: isLoopbackPeer(c),
    proto: c.req.header('x-forwarded-proto'),
    host,
  });
}
