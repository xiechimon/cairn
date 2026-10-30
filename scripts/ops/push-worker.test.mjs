import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { selfTests } from '../prepush.mjs';

function worker({ focused = false, showFails = false, token = 'secret' } = {}) {
  const handlers = new Map();
  const displayed = [];
  const requests = [];
  runInNewContext(readFileSync(new URL('../../apps/web/public/sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: {
        matchAll: async () => [{ visibilityState: focused ? 'visible' : 'hidden', focused }],
      },
      registration: {
        showNotification: async (...args) => {
          if (showFails) throw new Error('display failed');
          displayed.push(args);
        },
      },
    },
    URL,
    Response,
    caches: {
      open: async () => ({
        match: async () => (token ? new Response(JSON.stringify({ token })) : undefined),
      }),
    },
    fetch: async (...args) => {
      requests.push(args);
      return new Response('{}');
    },
  });
  return {
    displayed,
    requests,
    push: async (payload) => {
      let pending;
      handlers.get('push')({
        data: { json: () => payload },
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      await pending;
    },
  };
}
const payload = {
  web_push: 8030,
  mutable: true,
  id: 'id',
  receiptUrl: '/api/teams/team/push/receipts',
  requireReceipt: true,
  notification: { title: 'Paused', navigate: 'https://example.com/app?x=1' },
};

test('required alert displays before posting its authenticated id even with a focused page', async () => {
  const w = worker({ focused: true });
  await w.push(payload);
  assert.equal(w.displayed.length, 1);
  assert.equal(w.requests[0][0], payload.receiptUrl);
  assert.equal(w.requests[0][1].headers.authorization, 'Bearer secret');
  assert.equal(w.requests[0][1].body, '{"id":"id"}');
});
test('failed display never posts a receipt', async () => {
  const w = worker({ showFails: true });
  await assert.rejects(w.push(payload));
  assert.equal(w.requests.length, 0);
});
test('ordinary foreground pushes still display', async () => {
  const w = worker({ focused: true });
  await w.push({ notification: payload.notification });
  assert.equal(w.displayed.length, 1);
  assert.equal(w.requests.length, 0);
});
test('receipt works without a stored token and refuses external receipt URLs', async () => {
  const w = worker({ token: null });
  await w.push(payload);
  assert.equal(w.requests[0][1].headers.authorization, undefined);
  await w.push({ ...payload, receiptUrl: 'https://attacker.example/steal' });
  assert.equal(w.requests.length, 1);
});

test('ops tests run in prepush and the backup CI job and journal ends with a newline', async () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const path of ['scripts/ops/push-test.test.mjs', 'scripts/ops/push-worker.test.mjs']) {
    assert.ok(selfTests.includes(path));
    assert.ok(ci.slice(ci.indexOf('  ops-backup-test:')).includes(path));
  }
  assert.ok(
    readFileSync(
      new URL('../../apps/server/drizzle/meta/_journal.json', import.meta.url),
      'utf8',
    ).endsWith('\n'),
  );
});
