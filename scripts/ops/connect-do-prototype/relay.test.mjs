import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startRuntime } from './harness.mjs';

const send = (payload) => ({ v: 1, type: 'send', payload });
const reply = (client, payload) => ({ v: 1, type: 'reply', clientId: client.welcome.id, payload });

async function fixture(t, options) {
  const relay = await startRuntime(options);
  t.after(() => relay.dispose());
  return relay;
}

test('upgrade admission fails closed and roles cannot exchange credentials', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t);
  assert.deepEqual(await (await relay.request('/health')).json(), {
    protocol: 'cairn-do-experiment',
    version: 1,
  });
  assert.equal((await relay.request('/connect/host')).status, 426);
  assert.equal((await relay.request('/__test/clock')).status, 404);
  assert.equal((await relay.connect('client')).status, 503);
  for (const role of ['host', 'client']) {
    assert.equal((await relay.connect(role, { capability: '0'.repeat(64) })).status, 401);
    assert.equal(
      (await relay.connect(role, { authenticateAs: role === 'host' ? 'client' : 'host' })).status,
      401,
    );
    assert.equal((await relay.connect(role, { headers: { Authorization: '' } })).status, 401);
    assert.equal(
      (await relay.connect(role, { path: `/connect/${role}?token=forbidden` })).status,
      400,
    );
    assert.equal(
      (await relay.connect(role, { headers: { Origin: 'https://example.com' } })).status,
      400,
    );
    assert.equal(
      (await relay.connect(role, { headers: { 'Sec-WebSocket-Protocol': 'forbidden' } })).status,
      400,
    );
  }
  await relay.connect('host');
  assert.equal((await relay.connect('host')).status, 409);
  const clients = [];
  for (let i = 0; i < 16; i++) clients.push(await relay.connect('client'));
  assert.equal(new Set(clients.map((client) => client.welcome.id)).size, 16);
  assert.equal((await relay.connect('client')).status, 429);
});

test('missing and equal configuration never admits a host', { timeout: 20_000 }, async (t) => {
  for (const bindings of [
    { HOST_CAPABILITY: '' },
    { HOST_CAPABILITY: 'a'.repeat(64), CLIENT_CAPABILITY: 'a'.repeat(64) },
  ]) {
    const relay = await fixture(t, { bindings });
    assert.equal((await relay.connect('host')).status, 503);
  }
});

test('asymmetric clients remain isolated with ordered bursts and actual hibernation', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t);
  const host = await relay.connect('host');
  const first = await relay.connect('client');
  const second = await relay.connect('client');
  first.send(send('first-only'));
  assert.deepEqual(await host.next(), {
    v: 1,
    type: 'message',
    clientId: first.welcome.id,
    payload: 'first-only',
  });
  await relay.evict();
  for (let i = 0; i < 9; i++) second.send(send(`second-${i}`));
  for (let i = 0; i < 9; i++) {
    assert.deepEqual(await host.next(), {
      v: 1,
      type: 'message',
      clientId: second.welcome.id,
      payload: `second-${i}`,
    });
    host.send(reply(second, `result-${i}`));
    assert.deepEqual(await second.next(), { v: 1, type: 'reply', payload: `result-${i}` });
  }
  assert.deepEqual(first.messages, []);
  first.ws.close();
  await first.closed;
  const replacement = await relay.connect('client');
  assert.notEqual(replacement.welcome.id, first.welcome.id);
  host.send(reply(first, 'must-not-retarget'));
  assert.equal(await host.closed, 1008);
  await replacement.closed;
  assert.deepEqual(replacement.messages, []);
});

test('unknown fields, controls, binary and wrong-role envelopes cannot forward', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t);
  const host = await relay.connect('host');
  const invalid = [
    { ...send('forged'), sender: 'other' },
    { ...send('forged'), clientId: 'other' },
    { ...send('forged'), role: 'host' },
    { ...send('forged'), control: 'ping' },
    { v: 1, type: 'ping', payload: '' },
    { v: 2, type: 'send', payload: '' },
    { v: 1, type: 'reply', clientId: 'other', payload: '' },
    'not json',
    '[]',
  ];
  for (const input of invalid) {
    const client = await relay.connect('client');
    client.send(input);
    assert.equal(await client.closed, 1008);
    assert.deepEqual(host.messages, []);
  }
  const client = await relay.connect('client');
  client.ws.send(Buffer.from('binary'));
  assert.equal(await client.closed, 1008);
  const survivor = await relay.connect('client');
  const opaque = JSON.stringify({ role: 'host', clientId: survivor.welcome.id, type: 'control' });
  survivor.send(send(opaque));
  assert.deepEqual(await host.next(), {
    v: 1,
    type: 'message',
    clientId: survivor.welcome.id,
    payload: opaque,
  });
  host.send(send('wrong role'));
  assert.equal(await host.closed, 1008);
});

test('complete message bytes and multibyte payload boundaries are enforced', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t);
  const host = await relay.connect('host');
  const valid = await relay.connect('client');
  const payload = '界'.repeat(20_480);
  const encoded = JSON.stringify(send(payload));
  const exact = encoded + ' '.repeat(65_536 - Buffer.byteLength(encoded));
  valid.send(exact);
  assert.equal((await host.next()).payload, payload);
  const oversized = await relay.connect('client');
  oversized.send(`${exact} `);
  assert.equal(await oversized.closed, 1009);
  const tooMuchPayload = await relay.connect('client');
  tooMuchPayload.send(send(`${payload}a`));
  assert.equal(await tooMuchPayload.closed, 1008);
  assert.deepEqual(host.messages, []);
});

test('rate limits and fixed sender expiry survive live-socket eviction', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t, { instrument: true });
  await relay.request('/__test/clock?now=1800000000000');
  const host = await relay.connect('host');
  const client = await relay.connect('client');
  for (let i = 0; i < 119; i++) {
    client.send(send(`before-${i}`));
    assert.equal((await host.next()).payload, `before-${i}`);
  }
  await relay.evict();
  client.send(send('last-credit'));
  assert.equal((await host.next()).clientId, client.welcome.id);
  client.send(send('no-credit'));
  assert.equal(await client.closed, 1008);
  const fresh = await relay.connect('client');
  await relay.request('/__test/clock?now=1800003599999');
  await relay.evict();
  fresh.send(send('just-before-expiry'));
  assert.equal((await host.next()).payload, 'just-before-expiry');
  await relay.request('/__test/clock?now=1800003600000');
  fresh.send(send('at-expiry'));
  assert.equal(await fresh.closed, 1008);
  assert.deepEqual(host.messages, []);
});

test('silent expired recipient is refused; late old-host callback cannot retire replacement', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t, { instrument: true });
  await relay.request('/__test/clock?now=1800000000000');
  const oldHost = await relay.connect('host');
  await relay.request('/__test/clock?now=1800000001000');
  const oldClient = await relay.connect('client');
  await relay.evict();
  await relay.request('/__test/clock?now=1800003600000');
  oldClient.send(send('sender-live-recipient-expired'));
  assert.equal(await oldHost.closed, 1008);
  await oldClient.closed;
  assert.deepEqual(oldHost.messages, []);
  const host = await relay.connect('host');
  const client = await relay.connect('client');
  await relay.request('/__test/late-close');
  client.send(send('new-epoch-still-live'));
  assert.deepEqual(await host.next(), {
    v: 1,
    type: 'message',
    clientId: client.welcome.id,
    payload: 'new-epoch-still-live',
  });
  host.ws.close();
  await host.closed;
  await client.closed;
  assert.equal((await relay.connect('client')).status, 503);
});

test('paused peer and reconnect churn cannot refund cumulative output budgets', {
  timeout: 60_000,
}, async (t) => {
  const relay = await fixture(t);
  const payload = 'x'.repeat(60 * 1024);
  const firstHost = await relay.connect('host');
  const firstClient = await relay.connect('client');
  for (let i = 0; i < 17; i++) {
    firstClient.send(send(payload));
    assert.equal((await firstHost.next()).payload.length, 60 * 1024);
  }
  await relay.evict();
  firstHost.ws.pause();
  firstClient.send(send(payload));
  assert.equal(await firstClient.closed, 1013);
  firstHost.ws.resume();
  assert.equal(await firstHost.closed, 1013);

  const host = await relay.connect('host');
  for (let generation = 0; generation < 7; generation++) {
    const destination = await relay.connect('client');
    for (let i = 0; i < 17; i++) {
      host.send(reply(destination, payload));
      assert.equal((await destination.next()).payload.length, 60 * 1024);
    }
    if (generation === 3) await relay.evict();
  }
  const client = await relay.connect('client');
  host.send(reply(client, payload));
  assert.equal(await client.closed, 1013);
  assert.deepEqual(client.messages, []);
  assert.equal((await relay.connect('host')).status, 503);
  await relay.evict();
  assert.equal((await relay.connect('host')).status, 503);
});

test('injected send failure closes both peers; interrupted traffic is not replayed', {
  timeout: 20_000,
}, async (t) => {
  const relay = await fixture(t, { instrument: true });
  const host = await relay.connect('host');
  const client = await relay.connect('client');
  await relay.request('/__test/send-failure');
  client.send(send('cannot-deliver'));
  assert.equal(await client.closed, 1011);
  assert.equal(await host.closed, 1011);
  const reset = await fixture(t);
  const oldCredential = await relay.connect('host', {
    path: new URL('/connect/host', reset.base).href,
  });
  assert.equal(oldCredential.status, 401);
  const replacementHost = await reset.connect('host');
  const replacementClient = await reset.connect('client');
  replacementClient.send(send('only-new-traffic'));
  assert.equal((await replacementHost.next()).payload, 'only-new-traffic');
  await delay(30);
  assert.deepEqual(replacementHost.messages, []);
});
