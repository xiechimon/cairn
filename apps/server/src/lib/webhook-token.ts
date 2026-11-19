import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from './crypto.js';

export interface WebhookSecret {
  token: string;
  hash: string;
  masked: string;
}

export function webhookSecretOf(token: string): Omit<WebhookSecret, 'token'> {
  return {
    hash: sha256Hex(token),
    masked: `${token.slice(0, 12)}…${token.slice(-4)}`,
  };
}

export function newWebhookToken(): WebhookSecret {
  const token = `cairn-wh-${randomBytes(24).toString('hex')}`;
  return { token, ...webhookSecretOf(token) };
}

export function webhookTokenMatches(expectedHash: string, token: string): boolean {
  const expected = Buffer.from(expectedHash, 'utf8');
  const actual = Buffer.from(sha256Hex(token), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
