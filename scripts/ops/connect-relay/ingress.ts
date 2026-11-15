import {
  relayDescriptorSchema,
  relayPairBodySchema,
} from '../../../packages/shared/src/protocol/connect-relay';

export interface RelayEnvironment {
  INSTALLATION_ID?: string;
  ENVIRONMENT_ID?: string;
  PUBLIC_ORIGIN?: string;
  HOST_CAPABILITY?: string;
}

type Ingress =
  | { kind: 'descriptor'; descriptor: { v: 1; installationId: string; environmentId: string } }
  | { kind: 'host' }
  | { kind: 'client'; sessionToken: string }
  | { kind: 'pair'; code: string; name: string };

type Decision =
  | { ok: true; entry: Ingress }
  | {
      ok: false;
      status: 400 | 401 | 404 | 405 | 413 | 503;
      error: 'invalid' | 'denied' | 'too_large' | 'unknown';
    };

const tokenPattern = /^[a-f0-9]{64}$/;
const cookieName = '__Host-cairn_relay';
const encoder = new TextEncoder();

export async function readRelayIngress(
  request: Request,
  environment: RelayEnvironment,
): Promise<Decision> {
  let origin: URL;
  const descriptor = relayDescriptorSchema.safeParse({
    v: 1,
    installationId: environment.INSTALLATION_ID,
    environmentId: environment.ENVIRONMENT_ID,
  });
  try {
    origin = new URL(environment.PUBLIC_ORIGIN ?? '');
    if (
      !descriptor.success ||
      !tokenPattern.test(environment.HOST_CAPABILITY ?? '') ||
      origin.protocol !== 'https:' ||
      origin.origin !== environment.PUBLIC_ORIGIN ||
      environment.PUBLIC_ORIGIN?.slice('https://'.length).includes(':') ||
      origin.hostname.endsWith('.') ||
      origin.hostname === 'localhost' ||
      origin.hostname.endsWith('.localhost') ||
      /^127\./.test(origin.hostname) ||
      origin.hostname === '0.0.0.0'
    ) {
      return { ok: false, status: 503, error: 'unknown' };
    }
  } catch {
    return { ok: false, status: 503, error: 'unknown' };
  }
  const url = new URL(request.url);
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    request.url.includes('?') ||
    request.url.includes('#')
  ) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  if (!['/descriptor', '/pair', '/connect/host', '/connect/client'].includes(url.pathname)) {
    return { ok: false, status: 404, error: 'invalid' };
  }
  if (request.method !== (url.pathname === '/pair' ? 'POST' : 'GET')) {
    return { ok: false, status: 405, error: 'invalid' };
  }
  if (url.pathname === '/descriptor') {
    return { ok: true, entry: { kind: 'descriptor', descriptor: descriptor.data } };
  }
  const headers = request.headers;
  if (url.pathname === '/connect/host') {
    if (['Origin', 'Cookie', 'Sec-WebSocket-Protocol'].some((name) => headers.has(name))) {
      return { ok: false, status: 400, error: 'invalid' };
    }
    const actual = encoder.encode(headers.get('Authorization') ?? '');
    const expected = encoder.encode(`Bearer ${environment.HOST_CAPABILITY}`);
    if (
      actual.byteLength !== expected.byteLength ||
      !crypto.subtle.timingSafeEqual(actual, expected)
    ) {
      return { ok: false, status: 401, error: 'denied' };
    }
    if (headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return { ok: false, status: 400, error: 'invalid' };
    }
    return { ok: true, entry: { kind: 'host' } };
  }
  const pair = url.pathname === '/pair';
  if (
    headers.get('Origin') !== origin.origin ||
    headers.has('Authorization') ||
    headers.has('Sec-WebSocket-Protocol') ||
    (headers.has('Sec-Fetch-Site') && headers.get('Sec-Fetch-Site') !== 'same-origin') ||
    (headers.has('Sec-Fetch-Dest') && headers.get('Sec-Fetch-Dest') !== 'empty') ||
    (headers.has('Sec-Fetch-Mode') &&
      !(pair ? ['cors', 'same-origin'] : ['websocket']).includes(
        headers.get('Sec-Fetch-Mode') ?? '',
      ))
  ) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  const cookies = (headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.split('=', 1)[0].trim() === cookieName);
  const sessionToken = cookies[0]?.slice(cookies[0].indexOf('=') + 1).trim();
  if (cookies.length > 1 || (cookies.length === 1 && !tokenPattern.test(sessionToken ?? ''))) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  if (!pair) {
    if (!sessionToken) return { ok: false, status: 401, error: 'denied' };
    if (headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return { ok: false, status: 400, error: 'invalid' };
    }
    return { ok: true, entry: { kind: 'client', sessionToken } };
  }
  if (
    !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/i.test(
      headers.get('Content-Type') ?? '',
    )
  ) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  const length = headers.get('Content-Length');
  if (length !== null && !/^\d+$/.test(length)) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  if (length !== null && Number(length) > 1024) {
    return { ok: false, status: 413, error: 'too_large' };
  }
  if (!request.body || request.body.locked || request.bodyUsed) {
    return { ok: false, status: 400, error: 'invalid' };
  }
  const reader = request.body.getReader();
  try {
    const bytes = new Uint8Array(1024);
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - size) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'too_large' };
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    const body = relayPairBodySchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size)),
      ),
    );
    return { ok: true, entry: { kind: 'pair', ...body } };
  } catch {
    return { ok: false, status: 400, error: 'invalid' };
  } finally {
    reader.releaseLock();
  }
}
