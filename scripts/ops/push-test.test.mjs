import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPushTest } from './push-test.mjs';

test('sends one authenticated alert for the given user and prints receipt outcome', async () => {
  const calls = [];
  const lines = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (options.method === 'POST')
      return new Response(JSON.stringify({ id: 'notification' }), { status: 202 });
    return new Response(
      JSON.stringify({
        push: { status: 'delivered', count: 1, id: 'notification' },
        alertStatus: 'received',
      }),
    );
  };
  try {
    assert.equal(
      await runPushTest('https://fixture.invalid', 'team', 'owner', 'token', (line) =>
        lines.push(line),
      ),
      0,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0].pathname, '/api/teams/team/push/test/notification');
    assert.equal(calls[0][0].pathname, '/api/teams/team/push/test');
    assert.equal(calls[0][1].headers.authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(calls[0][1].body), { userId: 'owner' });
    assert.equal(JSON.parse(lines[0]).alertStatus, 'received');
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects unauthorized instances and never reports fallback as a phone receipt', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(
      runPushTest('https://fixture.invalid', 'team', 'owner', undefined, () => {}),
      /401/,
    );
    globalThis.fetch = async (_url, options) =>
      new Response(
        options.method === 'POST' ? '{"id":"notification"}' : '{"alertStatus":"fallback-accepted"}',
      );
    assert.equal(
      await runPushTest('https://fixture.invalid', 'team', 'owner', undefined, () => {}),
      1,
    );
    globalThis.fetch = async () => {
      throw new Error('unreachable');
    };
    await assert.rejects(
      runPushTest('https://fixture.invalid', 'team', 'owner', undefined, () => {}),
      /unreachable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('pending status is polled until receipt and the deadline bounds polling', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const original = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (_url, options) =>
    new Response(
      JSON.stringify(
        options.method === 'POST'
          ? { id: 'id' }
          : { alertStatus: ++polls === 1 ? 'pending' : 'received' },
      ),
    );
  try {
    assert.equal(
      await runPushTest('https://fixture.invalid', 't', 'u', undefined, () => {}, {
        pollMs: 1,
        timeoutMs: 100,
      }),
      0,
    );
    assert.equal(polls, 2);
    globalThis.fetch = async (_url, options) => {
      t.mock.timers.tick(1);
      return new Response(
        JSON.stringify(options.method === 'POST' ? { id: 'id' } : { alertStatus: 'pending' }),
      );
    };
    await assert.rejects(
      runPushTest('https://fixture.invalid', 't', 'u', undefined, () => {}, {
        pollMs: 1,
        timeoutMs: 5,
      }),
      /deadline|abort|timeout/i,
    );
  } finally {
    globalThis.fetch = original;
  }
});
