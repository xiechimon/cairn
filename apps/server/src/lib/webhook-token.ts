import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from './crypto.js';

export interface ScheduleWebhookSecret {
  token: string;
  hash: string;
  masked: string;
}

export function scheduleWebhookSecretOf(token: string): Omit<ScheduleWebhookSecret, 'token'> {
  return {
    hash: sha256Hex(token),
    masked: `${token.slice(0, 12)}…${token.slice(-4)}`,
  };
}

export function newScheduleWebhookToken(): ScheduleWebhookSecret {
  const token = `cairn-wh-${randomBytes(24).toString('hex')}`;
  return { token, ...scheduleWebhookSecretOf(token) };
}

export function scheduleWebhookTokenMatches(expectedHash: string, token: string): boolean {
  const expected = Buffer.from(expectedHash, 'utf8');
  const actual = Buffer.from(sha256Hex(token), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
