import { describe, expect, it } from 'vitest';
import { readNotifyPref, persistNotifyPref } from '../src/board/notify-pref.js';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

describe('readNotifyPref', () => {
  it('unset → null (initial face follows permissions, no tier preselected)', () => {
    expect(readNotifyPref(memStorage())).toBeNull();
  });

  it('garbage value → null (alien-shaped storage neither crashes nor misleads)', () => {
    for (const junk of ['maybe', '', '2', 'ON', 'true']) {
      expect(readNotifyPref(memStorage({ 'cairn.notifyEnabled': junk })), junk).toBeNull();
    }
  });
});

describe('persistNotifyPref × readNotifyPref round trip', () => {
  it('both tiers write/read symmetric', () => {
    const storage = memStorage();
    persistNotifyPref('off', storage);
    expect(readNotifyPref(storage)).toBe('off');
    persistNotifyPref('on', storage);
    expect(readNotifyPref(storage)).toBe('on');
  });

  it('the write face occupies only one brand key (cairn.* slots, locale family)', () => {
    const storage = memStorage();
    persistNotifyPref('off', storage);
    expect(Object.keys(storage.dump())).toEqual(['cairn.notifyEnabled']);
  });
});
