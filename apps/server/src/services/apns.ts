import { createHash, createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ClientHttp2Session, connect, constants } from 'node:http2';
import type { PushMessage } from './push.js';

export type ApnsEnvironment = 'sandbox' | 'production';

export interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
  origins?: Record<ApnsEnvironment, string>;
}

export interface ApnsDevice {
  token: string;
  environment: ApnsEnvironment;
}

export type ApnsOutcome = 'accepted' | 'expired' | 'failed' | 'unknown';

const APPLE_ORIGINS: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};
const TOKEN_LIFETIME_MS = 45 * 60 * 1000;
const EXPIRATION_SECONDS = 60 * 60;
const DEADLINE_MS = 10_000;
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);

export const APNS_TOKEN_PATTERN = /^[0-9a-f]{64,200}$/;

export function loadApnsConfig(input: {
  keyPath: string | null;
  keyId: string | null;
  teamId: string | null;
  bundleId: string;
}): ApnsConfig | null {
  const set = [input.keyPath, input.keyId, input.teamId].filter((value) => value !== null);
  if (set.length === 0) return null;
  if (set.length !== 3 || input.keyPath === null || input.keyId === null || input.teamId === null)
    throw new Error('set CAIRN_APNS_KEY_PATH, CAIRN_APNS_KEY_ID and CAIRN_APNS_TEAM_ID together');
  return {
    key: createPrivateKey(readFileSync(input.keyPath)),
    keyId: input.keyId,
    teamId: input.teamId,
    bundleId: input.bundleId,
  };
}

const providerTokens = new WeakMap<ApnsConfig, { issuedAt: number; jwt: string }>();

function providerToken(config: ApnsConfig): string {
  const now = Date.now();
  const cached = providerTokens.get(config);
  if (cached !== undefined && now - cached.issuedAt < TOKEN_LIFETIME_MS) return cached.jwt;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: config.keyId })}.${encode({
    iss: config.teamId,
    iat: Math.floor(now / 1000),
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: config.key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const jwt = `${unsigned}.${signature}`;
  providerTokens.set(config, { issuedAt: now, jwt });
  return jwt;
}

export function buildApnsPayload(msg: PushMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: msg.title.slice(0, 200), body: msg.body.slice(0, 1000) },
      sound: 'default',
      'thread-id': msg.tag,
    },
    href: msg.href,
  });
}

function collapseId(tag: string): string {
  return Buffer.byteLength(tag) <= 64 ? tag : createHash('sha256').update(tag).digest('hex');
}

const sessions = new Map<string, ClientHttp2Session>();

function sessionFor(origin: string): ClientHttp2Session {
  const existing = sessions.get(origin);
  if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;
  const session = connect(origin);
  const forget = () => {
    if (sessions.get(origin) === session) sessions.delete(origin);
  };
  session.on('error', forget);
  session.on('close', forget);
  session.on('goaway', forget);
  session.unref();
  sessions.set(origin, session);
  return session;
}

function outcomeOf(status: number, body: string): ApnsOutcome {
  if (status === 200) return 'accepted';
  if (status === 410) return 'expired';
  let reason: unknown;
  try {
    reason = (JSON.parse(body) as { reason?: unknown }).reason;
  } catch {
    reason = undefined;
  }
  return typeof reason === 'string' && DEAD_TOKEN_REASONS.has(reason) ? 'expired' : 'failed';
}

export function sendApns(
  config: ApnsConfig,
  device: ApnsDevice,
  msg: PushMessage,
): Promise<ApnsOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ApnsOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(outcome);
    };
    const deadline = setTimeout(() => {
      request?.close(constants.NGHTTP2_CANCEL);
      finish('unknown');
    }, DEADLINE_MS);
    let request: ReturnType<ClientHttp2Session['request']> | undefined;
    try {
      request = sessionFor((config.origins ?? APPLE_ORIGINS)[device.environment]).request({
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${providerToken(config)}`,
        'apns-topic': config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + EXPIRATION_SECONDS),
        'apns-collapse-id': collapseId(msg.tag),
        'content-type': 'application/json',
      });
    } catch {
      finish('failed');
      return;
    }
    let status = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => finish(outcomeOf(status, body)));
    request.on('error', () => finish('failed'));
    request.end(buildApnsPayload(msg));
  });
}
