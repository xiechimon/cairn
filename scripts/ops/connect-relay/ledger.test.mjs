import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const installation = '3a4e0091-4b08-49eb-b04e-8a8311b40636';
const midnight = Date.UTC(2026, 10, 15);
const now = midnight + 42_000;
const dayMs = 86_400_000;
const day = Math.floor(midnight / dayMs);
const limits = { dynamic: 2_000, pairs: 400, upgrades: 64, inbound: 10_000, output: 33_554_432 };
const empty = { dynamic: 0, pairs: 0, upgrades: 0, inbound: 0, output: 0 };
const directory = makeTestTempDir('relay-ledger-');
const source = stripTypeScriptTypes(
  await readFile(new URL('./ledger.ts', import.meta.url), 'utf8'),
  {
    mode: 'transform',
  },
);
const script = `import { DurableObject } from 'cloudflare:workers';
${source}
export class LedgerTest extends DurableObject {
  async fetch(request) {
    const input = await request.json();
    const sql = this.ctx.storage.sql;
    if (input.sql) {
      sql.exec(input.sql);
      return Response.json({ok:true});
    }
    if (input.inspect) {
      return Response.json({
        marker: sql.exec('SELECT * FROM relay_installation').toArray(),
        days: sql.exec('SELECT * FROM relay_daily ORDER BY day DESC').toArray(),
      });
    }
    try {
      const ledger = new RelayLedger(this.ctx.storage, input.installation ?? '${installation}');
      const result = ledger.reserve(input.now, input.cost);
      if (input.sendFailure) throw new Error('test send failure');
      return Response.json(result);
    } catch (error) {
      return Response.json({error: error instanceof RelayBudgetExceeded ? 'budget' : 'unavailable', resetAt: error.resetAt},
        {status: error instanceof RelayBudgetExceeded ? 429 : 503});
    }
  }
}
export default {fetch(request, env) {return env.RELAY.getByName(request.headers.get('x-test-name')).fetch(request)}};
`;
let runtime;
function start() {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'ledger-tests',
      host: '127.0.0.1',
      port: 0,
      modules: true,
      compatibilityDate: '2026-11-15',
      durableObjects: { RELAY: { className: 'LedgerTest', useSQLite: true } },
      resourcePersistencePath: directory,
      script,
    }),
  );
}
start();
after(async () => {
  await runtime.dispose();
  releaseTestTempDir(directory);
});
async function call(name, input = {}) {
  const response = await runtime.dispatchFetch('http://localhost/', {
    method: 'POST',
    headers: { 'x-test-name': name },
    body: JSON.stringify({ now, cost: {}, ...input }),
  });
  return { status: response.status, body: await response.json() };
}

test('fresh state and every exact daily cap; rejected compound costs consume nothing', async () => {
  for (const [key, limit] of Object.entries(limits)) {
    const name = `limit-${key}`;
    assert.deepEqual(await call(name), {
      status: 200,
      body: { resetAt: midnight + dayMs, usage: empty },
    });
    const reserved = await call(name, { cost: { [key]: limit } });
    assert.equal(reserved.status, 200);
    assert.deepEqual(reserved.body.usage, { ...empty, [key]: limit });
    assert.deepEqual(await call(name, { cost: { ...limits, [key]: 1 } }), {
      status: 429,
      body: { error: 'budget', resetAt: midnight + dayMs },
    });
    assert.deepEqual((await call(name)).body.usage, reserved.body.usage);
  }
});

test('competing reservations share one allowance without oversubscription', async () => {
  const results = await Promise.all(
    Array.from({ length: 70 }, () => call('contended', { cost: { upgrades: 1 } })),
  );
  assert.equal(results.filter((result) => result.status === 200).length, 64);
  assert.equal(results.filter((result) => result.status === 429).length, 6);
  assert.deepEqual((await call('contended')).body.usage, { ...empty, upgrades: 64 });
});

test('UTC rollover retains current/previous day; clock never rolls backwards', async () => {
  const name = 'rollover';
  await call(name, { cost: { dynamic: 123 } });
  assert.equal((await call(name, { now: now - 1 })).status, 503);
  const next = await call(name, { now: midnight + dayMs, cost: { pairs: 7 } });
  assert.deepEqual(next.body, { resetAt: midnight + 2 * dayMs, usage: { ...empty, pairs: 7 } });
  assert.equal((await call(name, { now })).status, 503);
  assert.deepEqual(
    (await call(name, { inspect: true })).body.days.map((row) => row.day),
    [day + 1, day],
  );
  await call(name, { now: midnight + 4 * dayMs, cost: { upgrades: 3 } });
  assert.deepEqual((await call(name, { inspect: true })).body.days, [
    { day: day + 4, ...empty, upgrades: 3 },
  ]);
});

test('denied reservations still fence backwards clock; failed sends never refund', async () => {
  await call('denial-clock', { cost: { pairs: 400 } });
  assert.equal((await call('denial-clock', { now: now + 10, cost: { pairs: 1 } })).status, 429);
  assert.equal((await call('denial-clock', { now: now + 9 })).status, 503);
  assert.equal(
    (await call('send-failure', { cost: { output: 101 }, sendFailure: true })).status,
    503,
  );
  assert.equal((await call('send-failure')).body.usage.output, 101);
});

test('missing/corrupt initialized state never becomes a fresh allowance', async () => {
  const faults = [
    'DELETE FROM relay_installation',
    'DROP TABLE relay_installation',
    'DROP TABLE relay_daily',
    'DELETE FROM relay_daily',
    'UPDATE relay_installation SET version = 2',
    'UPDATE relay_installation SET day = day + 1',
    'UPDATE relay_installation SET lastAt = 0',
    "UPDATE relay_installation SET installation = 'wrong'",
    'UPDATE relay_daily SET day = day - 1',
    'UPDATE relay_daily SET output = -1',
    'UPDATE relay_daily SET pairs = 401',
    'UPDATE relay_daily SET upgrades = 1.5',
    "UPDATE relay_daily SET dynamic = 'corrupt'",
    `INSERT INTO relay_daily VALUES (${day - 2}, 0, 0, 0, 0, 0)`,
  ];
  for (const [index, sql] of faults.entries()) {
    const name = `fault-${index}`;
    assert.equal((await call(name, { cost: { dynamic: 11 } })).status, 200);
    assert.equal((await call(name, { sql })).status, 200);
    assert.equal((await call(name)).status, 503, sql);
    assert.equal((await call(name, { now: now + dayMs })).status, 503, sql);
  }
  await call('unrecognized-database', { sql: 'CREATE TABLE unrelated (id INTEGER)' });
  assert.equal((await call('unrecognized-database')).status, 503);
});

test('SQL write failures roll back clock/rollover/partial reservations', async () => {
  const name = 'write-failure';
  await call(name, { cost: { dynamic: 21, output: 99 } });
  const before = (await call(name, { inspect: true })).body;
  await call(name, {
    sql: "CREATE TRIGGER deny_update BEFORE UPDATE ON relay_daily BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  });
  assert.equal((await call(name, { now: now + dayMs, cost: { pairs: 1 } })).status, 503);
  assert.deepEqual((await call(name, { inspect: true })).body, before);
  await call(name, { sql: 'DROP TRIGGER deny_update' });
  assert.deepEqual((await call(name)).body.usage, { ...empty, dynamic: 21, output: 99 });
});

test('invalid input cannot reduce counters or select another installation', async () => {
  const name = 'invalid';
  await call(name, { cost: { inbound: 3 } });
  for (const cost of [
    { inbound: -1 },
    { dynamic: 0.5 },
    { pairs: '1' },
    { other: 1 },
    { output: 2 ** 53 },
  ]) {
    assert.equal((await call(name, { cost })).status, 503);
  }
  for (const clock of [0, -1, 0.5, 2 ** 53, 'today']) {
    assert.equal((await call(name, { now: clock })).status, 503);
  }
  assert.equal(
    (await call(name, { installation: '4a4e0091-4b08-49eb-b04e-8a8311b40636' })).status,
    503,
  );
  assert.deepEqual((await call(name)).body.usage, { ...empty, inbound: 3 });
});

test('reservations survive real handler eviction and a persisted workerd restart', async () => {
  const name = 'persistent';
  const expected = { dynamic: 101, pairs: 13, upgrades: 7, inbound: 72, output: 2345 };
  assert.equal((await call(name, { cost: expected })).status, 200);
  await runtime.unsafeEvictDurableObject('ledger-tests', 'LedgerTest', { name });
  assert.deepEqual((await call(name)).body.usage, expected);
  await runtime.dispose();
  start();
  assert.deepEqual((await call(name)).body.usage, expected);
  assert.equal((await call(name, { now: now - 1 })).status, 503);
});
