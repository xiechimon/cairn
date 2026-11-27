import { describe, expect, test } from 'vitest';
import {
  pushSubscriptionBodySchema,
  pushSubscriptionBodySchemaForHosts,
} from '../src/records/push.js';

const VALID_KEYS = { p256dh: 'key-p256dh', auth: 'key-auth' };

describe('push subscription endpoint validation', () => {
  test('accepts standard push service hosts case-insensitively and subdomains', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://FCM.GOOGLEAPIS.COM/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QXYZ',
      'https://wns2-bl2p.notify.windows.com/?token=1',
    ]) {
      expect(
        pushSubscriptionBodySchema.safeParse({ endpoint, keys: VALID_KEYS }).success,
        endpoint,
      ).toBe(true);
    }
  });

  test('rejects unescaped dot lookalikes, bare suffix hosts, and non-https urls', () => {
    for (const endpoint of [
      'https://fcmXgoogleapis.com/fcm/send/abc',
      'https://updates-push.services.mozilla.com/wpush/v2/abc',
      'https://push.apple.com/abc',
      'https://notify.windows.com/abc',
      'https://evil.push.apple.com.attacker.test/abc',
      'http://fcm.googleapis.com/fcm/send/abc',
      'not-a-url',
    ]) {
      expect(
        pushSubscriptionBodySchema.safeParse({ endpoint, keys: VALID_KEYS }).success,
        endpoint,
      ).toBe(false);
    }
  });

  test('honors custom allowed hosts without wildcarding their dots', () => {
    const schema = pushSubscriptionBodySchemaForHosts(new Set(['push.example.test']));
    expect(
      schema.safeParse({ endpoint: 'https://PUSH.EXAMPLE.TEST/1', keys: VALID_KEYS }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ endpoint: 'https://pushXexample.test/1', keys: VALID_KEYS }).success,
    ).toBe(false);
  });
});
