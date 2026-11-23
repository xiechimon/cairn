import { TLSSocket } from 'node:tls';
import type { Http2Bindings, HttpBindings } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { forwardedOrigin } from './forwarded-origin.js';
import { tailnetOriginOf } from './tailnet-listener.js';

type NodeBindings = HttpBindings | Http2Bindings;

const LOOPBACK_PEER_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackPeer(c: Context): boolean {
  let peerAddress: string | undefined;
  try {
    peerAddress = getConnInfo(c).remote.address;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return peerAddress !== undefined && LOOPBACK_PEER_ADDRESSES.has(peerAddress);
}

export function requestOrigin(c: Context): string {
  const tailnet = tailnetOriginOf(c);
  if (tailnet !== null) return new URL(tailnet).origin;

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
