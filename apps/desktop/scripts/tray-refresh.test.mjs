import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDesktopLocalePreference } from '../src/locale.ts';
import { createTrayRefresh } from '../src/tray-refresh.ts';

const available = {
  status: 'ready',
  displayName: 'Owner',
  coordinatorBusy: false,
  groups: [],
  usage: null,
};
const unavailable = { status: 'unavailable' };

test('opening during prefetch drains one quota request when the active fetch settles', async () => {
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const attempts = [];
  const published = [];
  const refresh = createTrayRefresh(
    async (claimQuotaRefresh) => {
      if (attempts.length === 0) {
        attempts.push(claimQuotaRefresh());
        entered.resolve();
        await finish.promise;
      } else {
        attempts.push(claimQuotaRefresh());
      }
      return available;
    },
    (data) => published.push(data),
  );
  const pending = refresh();
  await entered.promise;
  assert.equal(refresh(true), pending);
  assert.equal(refresh(true), pending);
  finish.resolve();
  await pending;
  assert.deepEqual(attempts, [false, true]);
  assert.deepEqual(published, [available, available]);
});

test('only an attempted quota refresh starts the cooldown', async () => {
  let online = false;
  let now = 123;
  let posts = 0;
  const refresh = createTrayRefresh(
    async (claimQuotaRefresh) => {
      if (online && claimQuotaRefresh()) posts++;
      return online ? available : unavailable;
    },
    () => {},
    () => now,
  );
  await refresh(true);
  assert.equal(posts, 0);
  online = true;
  await refresh(true);
  await refresh(true);
  assert.equal(posts, 1);
  now += 60_000;
  await refresh(true);
  assert.equal(posts, 2);
});

for (const [system, choice] of [
  ['en-US', 'zh'],
  ['zh-CN', 'en'],
]) {
  test(`a background restart remembers ${choice} on a ${system} system without a window`, (t) => {
    const data = mkdtempSync(join(tmpdir(), 'tray-locale-'));
    t.after(() => rmSync(data, { recursive: true }));
    const existing = openDesktopLocalePreference(data, system, assert.fail);
    assert.notEqual(existing.locale(), choice);
    assert.equal(existing.set(choice), true);
    assert.equal(existing.set('invalid'), false);
    assert.equal(openDesktopLocalePreference(data, system, assert.fail).locale(), choice);
  });
}

test('a failed locale write still updates this session and does not replace the saved locale', (t) => {
  const data = mkdtempSync(join(tmpdir(), 'tray-locale-'));
  t.after(() => rmSync(data, { recursive: true }));
  writeFileSync(join(data, 'desktop-locale'), 'en\n');
  mkdirSync(join(data, 'desktop-locale.tmp'));
  const errors = [];
  const preference = openDesktopLocalePreference(data, 'en-US', (error) => errors.push(error));
  assert.equal(preference.set('zh'), true);
  assert.equal(preference.locale(), 'zh');
  assert.equal(errors.length, 1);
  assert.equal(openDesktopLocalePreference(data, 'zh-CN', assert.fail).locale(), 'en');
});
