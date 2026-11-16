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
const registrySource = stripTypeScriptTypes(
  await readFile(new URL('./registry.ts', import.meta.url), 'utf8'),
  { mode: 'transform' },
);
const script = `import { DurableObject } from 'cloudflare:workers';
import { RelayLedger, RelayBudgetExceeded } from './ledger';
import { RelayRegistry } from './registry.js';
export class LedgerTest extends DurableObject {
  async fetch(request) {
    const input = await request.json();
    const sql = this.ctx.storage.sql;
    if (input.query) return Response.json(sql.exec(input.query).toArray());
    if (input.sql) {
      sql.exec(input.sql);
      return Response.json({ok:true});
    }
    if (input.inspect) {
      return Response.json({
        marker: sql.exec('SELECT * FROM relay_installation').toArray(),
        days: sql.exec('SELECT * FROM relay_daily ORDER BY day DESC').toArray(),
        grants: sql.exec('SELECT * FROM relay_grant ORDER BY digest').toArray(),
        sessions: sql.exec('SELECT * FROM relay_session ORDER BY position').toArray(),
      });
    }
    try {
      const ledger = new RelayLedger(this.ctx.storage, input.installation ?? '${installation}');
      let result = ledger.reserve(input.now, input.cost);
      if (input.method) {
        const registry = new RelayRegistry(this.ctx.storage, input.installation ?? '${installation}');
        result = {value: registry[input.method](input.now, ...input.args) ?? null};
      }
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
      modules: [
        { type: 'ESModule', path: 'index.js', contents: script },
        { type: 'ESModule', path: 'ledger', contents: source },
        { type: 'ESModule', path: 'registry.js', contents: registrySource },
      ],
      compatibilityDate: '2026-11-15',
      durableObjects: { RELAY: { className: 'LedgerTest', useSQLite: true } },
      resourcePersistencePath: directory,
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

const epoch = 'b7eaaea2-d944-4858-98ba-8102a847a18e';
const otherEpoch = '78613edf-e831-43c9-a846-e596458cb902';
const digest = (id) => id.toString(16).padStart(64, '0');
const grant = (id, host = epoch) => ({ digest: digest(id), epoch: host, expiresAt: now + 300_000 });
const session = (id) => ({ digest: digest(id), deviceId: `device-${id}`, expiresAt: now + dayMs });
const invoke = (name, method, args, options = {}) => call(name, { method, args, ...options });

test('missing registry tables and old ledger-only databases fail closed without migration', async () => {
  for (const table of ['relay_grant', 'relay_session']) {
    const name = `missing-${table}`;
    await call(name, { cost: { dynamic: 77, output: 123 } });
    await call(name, { sql: `DROP TABLE ${table}` });
    const before = (await call(name, { query: 'SELECT * FROM relay_daily' })).body;
    assert.equal((await call(name, { cost: { pairs: 1 } })).status, 503);
    assert.equal((await invoke(name, 'findSession', [digest(1)])).status, 503);
    assert.deepEqual((await call(name, { query: 'SELECT * FROM relay_daily' })).body, before);
    assert.deepEqual(
      (await call(name, { query: `SELECT name FROM sqlite_master WHERE name = '${table}'` })).body,
      [],
    );
  }
  await call('old-ledger', { cost: { pairs: 19 } });
  await call('old-ledger', { sql: 'DROP TABLE relay_grant' });
  await call('old-ledger', { sql: 'DROP TABLE relay_session' });
  assert.equal((await call('old-ledger', { now: now + dayMs })).status, 503);
  assert.equal(
    (await call('old-ledger', { query: 'SELECT pairs FROM relay_daily' })).body[0].pairs,
    19,
  );
});

test('grant capacity and consumption are atomic, epoch-bound and nonrefundable', async () => {
  const name = 'grants';
  for (let id = 1; id <= 19; id++) {
    assert.equal((await invoke(name, 'putGrant', [grant(id)])).body.value, true);
  }
  const contending = await Promise.all(
    [20, 21, 22].map((id) => invoke(name, 'putGrant', [grant(id)])),
  );
  assert.equal(contending.filter((response) => response.body.value === true).length, 1);
  assert.equal((await call(name, { inspect: true })).body.grants.length, 20);
  assert.equal((await invoke(name, 'putGrant', [grant(1)])).body.value, true);
  for (const replacement of [grant(1, otherEpoch), { ...grant(1), expiresAt: now + 299_999 }]) {
    assert.equal((await invoke(name, 'putGrant', [replacement])).body.value, false);
  }
  assert.equal((await invoke(name, 'consumeGrant', [digest(1), otherEpoch])).body.value, false);
  const consumed = await Promise.all(
    Array.from({ length: 8 }, () => invoke(name, 'consumeGrant', [digest(1), epoch])),
  );
  assert.equal(consumed.filter((response) => response.body.value === true).length, 1);
  assert.equal(
    (await invoke(name, 'consumeGrant', [digest(2), epoch], { sendFailure: true })).status,
    503,
  );
  assert.equal((await invoke(name, 'consumeGrant', [digest(2), epoch])).body.value, false);
  await invoke(name, 'putGrant', [grant(99, otherEpoch)]);
  await invoke(name, 'rememberSession', [session(1)]);
  await invoke(name, 'retireEpoch', [epoch]);
  assert.deepEqual((await call(name, { inspect: true })).body.grants, [grant(99, otherEpoch)]);
  assert.deepEqual((await invoke(name, 'findSession', [digest(1)])).body.value, session(1));
  assert.equal(
    (await invoke(name, 'consumeGrant', [digest(99), otherEpoch], { now: now + 300_000 })).body
      .value,
    false,
  );
  assert.deepEqual((await call(name, { inspect: true })).body.grants, []);
  assert.equal(
    (
      await invoke(name, 'putGrant', [{ ...grant(100), expiresAt: now + 600_000 }], {
        now: now + 300_000,
      })
    ).body.value,
    true,
  );
});

test('session FIFO is bounded under contention and same-digest reentry cannot renew or replace', async () => {
  const name = 'sessions';
  for (let id = 1; id <= 49; id++) await invoke(name, 'rememberSession', [session(id)]);
  await Promise.all([50, 51, 52].map((id) => invoke(name, 'rememberSession', [session(id)])));
  const rows = (await call(name, { inspect: true })).body.sessions;
  assert.equal(rows.length, 50);
  assert.equal((await invoke(name, 'findSession', [digest(1)])).body.value, null);
  const oldest = rows[0];
  const original = {
    digest: oldest.digest,
    deviceId: oldest.deviceId,
    expiresAt: oldest.expiresAt,
  };
  await invoke(name, 'rememberSession', [original]);
  await invoke(name, 'findSession', [oldest.digest]);
  for (const replacement of [
    { ...original, deviceId: 'other-device' },
    { ...original, expiresAt: original.expiresAt + 1 },
  ]) {
    assert.equal((await invoke(name, 'rememberSession', [replacement])).status, 503);
    assert.deepEqual((await call(name, { inspect: true })).body.sessions, rows);
  }
  await invoke(name, 'rememberSession', [session(53)]);
  assert.equal((await invoke(name, 'findSession', [oldest.digest])).body.value, null);
  assert.deepEqual((await invoke(name, 'findSession', [digest(53)])).body.value, session(53));
  for (let id = 54; id <= 110; id++) {
    await invoke(name, 'rememberSession', [session(id)]);
    await invoke(name, 'forgetSession', [digest(id)]);
  }
  assert.equal((await call(name, { inspect: true })).body.sessions.length, 49);
  await invoke(name, 'forgetSession', [digest(110)]);
  assert.equal((await invoke(name, 'findSession', [digest(110)])).body.value, null);
  assert.equal(
    (await invoke(name, 'findSession', [digest(53)], { now: now + dayMs })).body.value,
    null,
  );
  assert.equal((await call(name, { inspect: true })).body.sessions.length, 0);
});

test('corruption fails before cleanup, and SQL insertion failure preserves FIFO but not refunds', async () => {
  const faults = [
    "UPDATE relay_grant SET epoch = 'broken'",
    'UPDATE relay_grant SET expiresAt = 0',
    "UPDATE relay_grant SET digest = 'broken'",
    "UPDATE relay_session SET digest = 'broken'",
    "UPDATE relay_session SET deviceId = ''",
    'UPDATE relay_session SET expiresAt = 0',
    'UPDATE relay_session SET position = -1',
  ];
  for (const [index, sql] of faults.entries()) {
    const name = `registry-corrupt-${index}`;
    await invoke(name, 'putGrant', [grant(1)]);
    await invoke(name, 'rememberSession', [session(1)]);
    await call(name, { sql });
    const before = (await call(name, { inspect: true })).body;
    assert.equal((await invoke(name, 'retireEpoch', [epoch], { now: now + dayMs })).status, 503);
    const after = (await call(name, { inspect: true })).body;
    assert.deepEqual(after.grants, before.grants);
    assert.deepEqual(after.sessions, before.sessions);
  }
  const name = 'registry-write-failure';
  for (let id = 1; id <= 50; id++) await invoke(name, 'rememberSession', [session(id)]);
  const before = (await call(name, { inspect: true })).body.sessions;
  await call(name, {
    sql: "CREATE TRIGGER deny_session BEFORE INSERT ON relay_session BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  });
  assert.equal(
    (await invoke(name, 'rememberSession', [session(51)], { cost: { output: 127 } })).status,
    503,
  );
  assert.deepEqual((await call(name, { inspect: true })).body.sessions, before);
  assert.equal((await call(name)).body.usage.output, 127);
  await call(name, { sql: 'DROP TRIGGER deny_session' });
  await invoke(name, 'rememberSession', [session(51)]);
  assert.equal((await invoke(name, 'findSession', [digest(1)])).body.value, null);
});

test('registry survives eviction/restart with consumed grants, FIFO order and original budgets', async () => {
  const name = 'registry-persistent';
  await invoke(name, 'putGrant', [grant(1)], { cost: { dynamic: 41 } });
  await invoke(name, 'putGrant', [grant(2, otherEpoch)]);
  await invoke(name, 'consumeGrant', [digest(1), epoch]);
  await invoke(name, 'rememberSession', [session(1)]);
  await invoke(name, 'rememberSession', [session(2)]);
  const before = (await call(name, { inspect: true })).body;
  await runtime.unsafeEvictDurableObject('ledger-tests', 'LedgerTest', { name });
  assert.deepEqual((await call(name, { inspect: true })).body, before);
  await runtime.dispose();
  start();
  assert.deepEqual((await call(name, { inspect: true })).body, before);
  assert.equal((await invoke(name, 'consumeGrant', [digest(1), epoch])).body.value, false);
  assert.equal((await invoke(name, 'consumeGrant', [digest(2), otherEpoch])).body.value, true);
  assert.equal((await call(name)).body.usage.dynamic, 41);
});

test('metadata input boundaries and over-cap persisted state reject without destructive cleanup', async () => {
  for (const value of [
    { ...grant(1), digest: 'not-a-digest' },
    { ...grant(1), epoch: 'wrong' },
    { ...grant(1), expiresAt: now },
    { ...grant(1), expiresAt: now + 300_001 },
  ]) {
    assert.equal((await invoke('invalid-registry', 'putGrant', [value])).status, 503);
  }
  for (const value of [
    { ...session(1), deviceId: '' },
    { ...session(1), deviceId: 'x'.repeat(129) },
    { ...session(1), expiresAt: now },
    { ...session(1), expiresAt: now + 30 * dayMs + 1 },
  ]) {
    assert.equal((await invoke('invalid-registry', 'rememberSession', [value])).status, 503);
  }
  assert.equal(
    (
      await invoke('invalid-registry', 'rememberSession', [
        { ...session(1), expiresAt: now + 30 * dayMs },
      ])
    ).status,
    200,
  );
  for (const [table, count, columns, values] of [
    ['relay_grant', 21, 'digest, epoch, expiresAt', `printf('%064x', x), '${epoch}', ${now + 1}`],
    [
      'relay_session',
      51,
      'digest, deviceId, expiresAt',
      `printf('%064x', x), 'device', ${now + 1}`,
    ],
  ]) {
    const name = `over-cap-${table}`;
    await call(name);
    await call(name, {
      sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < ${count}) INSERT INTO ${table} (${columns}) SELECT ${values} FROM n`,
    });
    assert.equal((await invoke(name, 'findSession', [digest(1)], { now: now + 2 })).status, 503);
    assert.equal(
      (await call(name, { query: `SELECT count(*) AS n FROM ${table}` })).body[0].n,
      count,
    );
  }
});
