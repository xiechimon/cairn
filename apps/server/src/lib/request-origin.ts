import { isIP } from 'node:net';
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

type NodeBindings = HttpBindings | Http2Bindings;

const PROXY_FORWARDING_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
  'x-real-ip',
  'via',
  'cf-connecting-ip',
] as const;

const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

export function normalizePeerAddress(raw: string): string {
  const trimmed = raw.trim().toLowerCase().split('%')[0] ?? '';
  const unwrapped =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (isIP(unwrapped) === 4) return unwrapped;
  if (isIP(unwrapped) === 6) {
    const parsed = URL.parse(`http://[${unwrapped}]/`);
    const canonical =
      parsed === null ? unwrapped : parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const mapped = IPV4_MAPPED_HEX.exec(canonical);
    if (mapped !== null) {
      const high = Number.parseInt(mapped[1] ?? '0', 16);
      const low = Number.parseInt(mapped[2] ?? '0', 16);
      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    }
    return canonical;
  }
  return unwrapped.startsWith('::ffff:') ? unwrapped.slice('::ffff:'.length) : unwrapped;
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizePeerAddress(address);
  return normalized === '::1' || normalized.startsWith('127.');
}

export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (host === undefined || host.trim() === '') return true;
  const parsed = URL.parse(`http://${host.trim()}`);
  if (parsed === null) return false;
  const hostname = normalizePeerAddress(parsed.hostname);
  return hostname === 'localhost' || isLoopbackAddress(hostname);
}

function peerAddressOf(c: Context): string | undefined {
  try {
    const raw = getConnInfo(c).remote.address;
    return raw === undefined ? undefined : normalizePeerAddress(raw);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}

export function hasProxyForwardingHeaders(c: Context): boolean {
  return PROXY_FORWARDING_HEADERS.some((header) => c.req.header(header) !== undefined);
}

export function isLoopbackPeer(c: Context): boolean {
  const peerAddress = peerAddressOf(c);
  return peerAddress !== undefined && isLoopbackAddress(peerAddress);
}

export function isTrustedProxyAddress(
  address: string,
  trustedProxies?: ReadonlySet<string>,
): boolean {
  const normalized = normalizePeerAddress(address);
  return isLoopbackAddress(normalized) || (trustedProxies?.has(normalized) ?? false);
}

export function isTrustedProxyPeer(c: Context, trustedProxies?: ReadonlySet<string>): boolean {
  const peerAddress = peerAddressOf(c);
  if (peerAddress === undefined) return false;
  return isTrustedProxyAddress(peerAddress, trustedProxies);
}

export function isDirectLoopbackPeer(c: Context): boolean {
  return (
    isLoopbackPeer(c) &&
    tailnetListenerOf(c) === null &&
    !hasTailscaleIdentityHeaders(c) &&
    !hasProxyForwardingHeaders(c)
  );
}

const TAILSCALE_PEER = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/;
const LAN_PEER =
  /^(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|f[cd][0-9a-f]*:|fe80:)/i;

function parseIpCandidate(raw: string): string | null {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end <= 1) return null;
    value = value.slice(1, end);
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  const normalized = normalizePeerAddress(value);
  return isIP(normalized) !== 0 ? normalized : null;
}

function rightmostUntrustedIp(
  entries: ReadonlyArray<string | null>,
  trustedProxies?: ReadonlySet<string>,
): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = entries[i];
    if (candidate === null || candidate === undefined) return null;
    if (!isTrustedProxyAddress(candidate, trustedProxies)) return candidate;
  }
  return null;
}

function parseForwardedForEntries(header: string): Array<string | null> {
  return header.split(',').map((part) => parseIpCandidate(part));
}

function parseRfcForwardedForEntries(header: string): Array<string | null> {
  const entries: Array<string | null> = [];
  for (const entry of header.split(',')) {
    let found = false;
    for (const param of entry.split(';')) {
      const trimmed = param.trim();
      if (!trimmed.toLowerCase().startsWith('for=')) continue;
      found = true;
      entries.push(parseIpCandidate(trimmed.slice(4)));
    }
    if (!found) entries.push(null);
  }
  return entries;
}

function extractProxiedClientIp(c: Context, trustedProxies?: ReadonlySet<string>): string | null {
  const xff = c.req.header('x-forwarded-for');
  if (xff !== undefined) {
    return rightmostUntrustedIp(parseForwardedForEntries(xff), trustedProxies);
  }

  const forwarded = c.req.header('forwarded');
  if (forwarded !== undefined) {
    return rightmostUntrustedIp(parseRfcForwardedForEntries(forwarded), trustedProxies);
  }

  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp !== undefined) {
    const candidate = parseIpCandidate(cfIp);
    return candidate !== null && !isTrustedProxyAddress(candidate, trustedProxies)
      ? candidate
      : null;
  }

  const realIp = c.req.header('x-real-ip');
  if (realIp !== undefined) {
    const candidate = parseIpCandidate(realIp);
    return candidate !== null && !isTrustedProxyAddress(candidate, trustedProxies)
      ? candidate
      : null;
  }

  return null;
}

export function pairRequestPeerOf(
  c: Context,
  trustedProxies?: ReadonlySet<string>,
): { source: PairRequestSource; peer: string } {
  const tailnetIdentity = tailnetIdentityOf(c);
  const address = peerAddressOf(c);
  const peer = tailnetIdentity?.login ?? address ?? 'unknown';
  if (tailnetOriginOf(c) !== null) return { source: 'tailnet', peer };
  if (address === undefined) return { source: 'unknown', peer };
  if (isTrustedProxyPeer(c, trustedProxies) && hasProxyForwardingHeaders(c)) {
    const clientIp = extractProxiedClientIp(c, trustedProxies);
    if (clientIp === null) return { source: 'public', peer: `proxied:${address}` };
    if (TAILSCALE_PEER.test(clientIp)) return { source: 'tailnet', peer: clientIp };
    if (LAN_PEER.test(clientIp)) return { source: 'lan', peer: clientIp };
    return { source: 'public', peer: clientIp };
  }
  if (isLoopbackAddress(address)) return { source: 'loopback', peer };
  if (TAILSCALE_PEER.test(address)) return { source: 'tailnet', peer };
  if (LAN_PEER.test(address)) return { source: 'lan', peer };
  return { source: 'public', peer };
}

export function forwardedHostFor(
  hostHeader: string | undefined,
  forwardedHost: string | undefined,
): string | undefined {
  if (forwardedHost !== undefined && isLoopbackHostHeader(hostHeader)) return forwardedHost;
  return hostHeader;
}

export function requestOrigin(
  c: Context,
  trustedWebOrigin?: string,
  trustedProxies?: ReadonlySet<string>,
): string {
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
  const rawHost = c.req.header('host');
  const host = rawHost ?? requestUrl.host;
  const url = URL.parse(`${protocol}//${host}`) ?? requestUrl;
  const forwarded = forwardedOrigin({
    url: url.href,
    trustedProxy: isTrustedProxyPeer(c, trustedProxies),
    proto: c.req.header('x-forwarded-proto'),
    host: forwardedHostFor(rawHost, c.req.header('x-forwarded-host')) ?? host,
  });
  if (trustedWebOrigin !== undefined) {
    const trusted = URL.parse(trustedWebOrigin);
    const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (
      trusted !== null &&
      trusted.protocol === 'https:' &&
      forwardedProto === 'https' &&
      new URL(forwarded).host.toLowerCase() === trusted.host.toLowerCase()
    ) {
      return trusted.origin;
    }
  }
  return forwarded;
}
