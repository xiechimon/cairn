import assert from 'node:assert/strict';
import { startRuntime } from './harness.mjs';

const relay = await startRuntime();
try {
  const host = await relay.connect('host');
  const first = await relay.connect('client');
  const second = await relay.connect('client');
  first.send({ v: 1, type: 'send', payload: 'synthetic-first' });
  second.send({ v: 1, type: 'send', payload: 'synthetic-second' });
  const arrivals = [await host.next(), await host.next()];
  assert.deepEqual(
    new Set(arrivals.map((message) => message.clientId)),
    new Set([first.welcome.id, second.welcome.id]),
  );
  for (const message of arrivals)
    host.send({
      v: 1,
      type: 'reply',
      clientId: message.clientId,
      payload: `reply:${message.payload}`,
    });
  assert.deepEqual(await first.next(), { v: 1, type: 'reply', payload: 'reply:synthetic-first' });
  assert.deepEqual(await second.next(), { v: 1, type: 'reply', payload: 'reply:synthetic-second' });
  await relay.evict();
  second.send({ v: 1, type: 'send', payload: 'after-eviction' });
  assert.deepEqual(await host.next(), {
    v: 1,
    type: 'message',
    clientId: second.welcome.id,
    payload: 'after-eviction',
  });
  console.log(
    'PASS: two synthetic clients isolated; live sockets and identity survived actual DO eviction. No Cairn/model/cloud connection.',
  );
} finally {
  await relay.dispose();
}
