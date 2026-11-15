import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const serverRequire = createRequire(new URL('../../../apps/server/package.json', import.meta.url));
const webRequire = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { tsImport } = await import(serverRequire.resolve('tsx/esm/api'));
const { openMemoryDb } = await tsImport('../../../apps/server/src/db/client.ts', import.meta.url);
const native = openMemoryDb();
let statements;
try {
  statements = native.$client
    .prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY type DESC, name",
    )
    .all()
    .map((row) => row.sql);
} finally {
  native.$client.close();
}
const { build } = await import(webRequire.resolve('vite'));
const bundled = await build({
  configFile: false,
  logLevel: 'silent',
  resolve: {
    alias: {
      'drizzle-orm': fileURLToPath(
        new URL('../../../apps/server/node_modules/drizzle-orm', import.meta.url),
      ),
    },
  },
  build: {
    write: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./sqlite-compat.worker.ts', import.meta.url)),
      formats: ['es'],
    },
    rolldownOptions: { external: ['cloudflare:workers'] },
  },
});
const output = Array.isArray(bundled) ? bundled[0] : bundled;
const directory = makeTestTempDir('cf-sqlite-compat-');
let runtime;
function start() {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'sqlite-compatibility',
      host: '127.0.0.1',
      port: 0,
      compatibilityDate: '2026-11-15',
      modules: [{ type: 'ESModule', path: 'index.js', contents: output.output[0].code }],
      bindings: { SCHEMA: JSON.stringify(statements) },
      durableObjects: { DATABASE: { className: 'SqliteCompatibility', useSQLite: true } },
      resourcePersistencePath: directory,
    }),
  );
}
start();
after(async () => {
  await runtime.dispose();
  releaseTestTempDir(directory);
});
async function call(database, operation, fields = {}) {
  const response = await runtime.dispatchFetch('http://localhost/', {
    method: 'POST',
    headers: { 'x-test-database': database },
    body: JSON.stringify({ operation, ...fields }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('current native schema loads in DO; real shared mappings preserve JSON, booleans, defaults and nulls', async () => {
  await call('mapping', 'seed');
  const actual = await call('mapping', 'mapping');
  assert.deepEqual(
    actual.machines.map(({ id, online, enabledRuntimes, maxConcurrent, tokenHash }) => ({
      id,
      online,
      enabledRuntimes,
      maxConcurrent,
      tokenHash,
    })),
    [
      { id: 'alpha', online: true, enabledRuntimes: ['pi'], maxConcurrent: 3, tokenHash: null },
      { id: 'beta', online: false, enabledRuntimes: [], maxConcurrent: 3, tokenHash: null },
    ],
  );
  assert.equal(actual.step.status, 'pending');
  assert.equal(actual.step.byPerson, false);
  assert.equal(actual.step.machineId, null);
  assert.equal(actual.missing, null);
});

test('competing conditional claims return one winner and a zero-row loser, including the hold boundary', async () => {
  await call('claims', 'seed');
  const results = await Promise.all(
    ['alpha', 'beta'].map((machineId) =>
      call('claims', 'claim', { id: 'available', machineId, now: 1_000 }),
    ),
  );
  const winners = results.filter(({ winner }) => winner !== null);
  assert.equal(winners.length, 1);
  assert.equal(results.filter(({ winner }) => winner === null).length, 1);
  assert.equal(winners[0].winner.id, 'available');
  assert.ok(['alpha', 'beta'].includes(winners[0].winner.machineId));
  assert.deepEqual(await call('claims', 'claim', { id: 'held', machineId: 'alpha', now: 1_000 }), {
    winner: null,
  });
  assert.deepEqual(await call('claims', 'claim', { id: 'held', machineId: 'beta', now: 1_001 }), {
    winner: { id: 'held', machineId: 'beta' },
  });
  await runtime.dispose();
  start();
  const { step } = await call('claims', 'mapping');
  assert.equal(step.status, 'claimed');
  assert.equal(step.machineId, winners[0].winner.machineId);
  assert.equal(step.claimedAt, 1_000);
  assert.deepEqual(
    await call('claims', 'claim', { id: 'available', machineId: 'alpha', now: 2_000 }),
    { winner: null },
  );
});

test('thrown transaction rolls back; caught nested failure preserves outer writes only', async () => {
  await call('transactions', 'seed');
  assert.deepEqual(await call('transactions', 'rollback'), [{ name: 'Alpha' }, { name: 'Beta' }]);
  assert.deepEqual(await call('transactions', 'nested'), [
    { id: 'alpha', name: 'after catch' },
    { id: 'beta', name: 'Beta' },
  ]);
});

test('installed DO driver mutates the row but does not provide native changes metadata', async () => {
  await call('metadata', 'seed');
  assert.deepEqual(await call('metadata', 'metadata'), {
    resultType: 'undefined',
    row: { lastSeenAt: 55 },
  });
});

test('production lease preserves owner fencing, strict expiry and persistence on DO storage', async () => {
  const fields = (machineId, now, id = 'shared-store') => ({ id, machineId, now });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 1_000)), {
    acquired: true,
  });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 1_500)), {
    acquired: true,
  });
  assert.deepEqual(await call('leases', 'lease-read', fields('alpha', 1_500)), {
    storeKey: 'shared-store',
    owner: 'alpha',
    heartbeatAt: 1_500,
  });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('beta', 1_501)), {
    acquired: false,
  });
  assert.deepEqual(await call('leases', 'lease-heartbeat', fields('alpha', 2_000)), {
    owned: true,
  });
  for (const now of [46_999, 47_000]) {
    assert.deepEqual(await call('leases', 'lease-acquire', fields('beta', now)), {
      acquired: false,
    });
  }
  assert.deepEqual(await call('leases', 'lease-acquire', fields('beta', 47_001)), {
    acquired: true,
  });
  assert.deepEqual(await call('leases', 'lease-heartbeat', fields('alpha', 47_002)), {
    owned: false,
  });
  await call('leases', 'lease-release', fields('alpha', 47_003));
  assert.deepEqual(await call('leases', 'lease-read', fields('beta', 47_003)), {
    storeKey: 'shared-store',
    owner: 'beta',
    heartbeatAt: 47_001,
  });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 47_004)), {
    acquired: false,
  });
  assert.deepEqual(await call('leases', 'lease-read', fields('beta', 47_004)), {
    storeKey: 'shared-store',
    owner: 'beta',
    heartbeatAt: 47_001,
  });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 47_004, 'other-store')), {
    acquired: true,
  });
  await runtime.dispose();
  start();
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 47_005)), {
    acquired: false,
  });
  assert.deepEqual(await call('leases', 'lease-acquire', fields('beta', 47_006)), {
    acquired: true,
  });
  await call('leases', 'lease-release', fields('beta', 47_007));
  assert.deepEqual(await call('leases', 'lease-acquire', fields('alpha', 47_008)), {
    acquired: true,
  });
});
