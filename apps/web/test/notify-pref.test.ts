import { describe, expect, it } from 'vitest';
import {
  migrateLegacyNotifications,
  NOTIFICATIONS_KEY,
  notificationsOn,
  persistNotificationsChoice,
  readNotificationsChoice,
} from '../src/board/notify-pref.js';

const LEGACY_KEY = 'cairn.notifyEnabled';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe('migrateLegacyNotifications', () => {
  const combos = [
    { inApp: '0', deviceSubscribed: false, expected: '0' },
    { inApp: '1', deviceSubscribed: false, expected: '1' },
    { inApp: '0', deviceSubscribed: true, expected: '1' },
    { inApp: '1', deviceSubscribed: true, expected: '1' },
  ];
  for (const { inApp, deviceSubscribed, expected } of combos) {
    it(`in-app ${inApp} + device push ${deviceSubscribed ? 'on' : 'off'} becomes ${expected}`, () => {
      const storage = memStorage({ [LEGACY_KEY]: inApp });
      migrateLegacyNotifications(storage, deviceSubscribed);
      expect(storage.dump()).toEqual({ [NOTIFICATIONS_KEY]: expected });
    });
  }

  it('an untouched in-app switch keeps following the browser permission unless the device was subscribed', () => {
    const untouched = memStorage();
    migrateLegacyNotifications(untouched, false);
    expect(untouched.dump()).toEqual({});
    const subscribed = memStorage();
    migrateLegacyNotifications(subscribed, true);
    expect(subscribed.dump()).toEqual({ [NOTIFICATIONS_KEY]: '1' });
  });

  it('leaves the legacy choice readable when migration cannot save it', () => {
    const storage = memStorage({ [LEGACY_KEY]: '0' });
    const unwritable = { ...storage, setItem: () => { throw new Error('storage full'); } };
    migrateLegacyNotifications(unwritable, false);
    expect(storage.dump()).toEqual({ [LEGACY_KEY]: '0' });
    expect(readNotificationsChoice(storage)).toBe(false);
  });

  it('never overrides a choice made on the new switch', () => {
    const storage = memStorage({ [NOTIFICATIONS_KEY]: '0', [LEGACY_KEY]: '1' });
    migrateLegacyNotifications(storage, true);
    expect(storage.dump()).toEqual({ [NOTIFICATIONS_KEY]: '0' });
  });
});

describe('notifications choice', () => {
  it('round-trips and falls back to the permission when unset', () => {
    const storage = memStorage();
    expect(notificationsOn(readNotificationsChoice(storage), 'granted')).toBe(true);
    expect(notificationsOn(readNotificationsChoice(storage), 'default')).toBe(false);
    persistNotificationsChoice(false, storage);
    expect(notificationsOn(readNotificationsChoice(storage), 'granted')).toBe(false);
    persistNotificationsChoice(true, storage);
    expect(notificationsOn(readNotificationsChoice(storage), 'denied')).toBe(false);
    expect(notificationsOn(readNotificationsChoice(storage), 'granted')).toBe(true);
  });
});
