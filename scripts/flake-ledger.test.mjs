import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadFlakeLedger,
  playwrightFileId,
  reportRetryGreen,
  retryGreenVerdict,
} from './flake-ledger.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

function ledgerFixture(t, rows) {
  const root = makeTestTempDir('flake-ledger-');
  t.after(() => releaseTestTempDir(root));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const row of rows) {
    mkdirSync(join(root, row.path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(root, row.path), 'test\n');
  }
  writeFileSync(
    join(root, 'scripts/flake-ledger.json'),
    JSON.stringify({ version: 1, flakes: rows }),
  );
  return root;
}

const row = {
  path: 'apps/web/e2e/token-gate.spec.ts',
  owner: 'xiechimon',
  expires: '2099-01-01',
  reason: 'known polling timing flake',
};

test('valid ledger rows classify listed and unlisted retry-green files', (t) => {
  const root = ledgerFixture(t, [row]);
  const entries = loadFlakeLedger({ cwd: root, now: new Date('2026-11-25T00:00:00Z') });
  assert.deepEqual(retryGreenVerdict([row.path, 'integration/test/other.test.ts'], entries), {
    listed: [{ path: row.path, entry: entries[0] }],
    unlisted: ['integration/test/other.test.ts'],
  });
});

test('expired, duplicate and missing-file rows fail validation', (t) => {
  const expired = ledgerFixture(t, [{ ...row, expires: '2026-11-24' }]);
  assert.throws(
    () => loadFlakeLedger({ cwd: expired, now: new Date('2026-11-25T00:00:00Z') }),
    /expired on 2026-11-24/,
  );
  const duplicate = ledgerFixture(t, [row, row]);
  assert.throws(
    () => loadFlakeLedger({ cwd: duplicate, now: new Date('2026-11-25T00:00:00Z') }),
    /duplicate path/,
  );
  const root = makeTestTempDir('flake-missing-');
  t.after(() => releaseTestTempDir(root));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts/flake-ledger.json'),
    JSON.stringify({ version: 1, flakes: [row] }),
  );
  assert.throws(
    () => loadFlakeLedger({ cwd: root, now: new Date('2026-11-25T00:00:00Z') }),
    /does not exist/,
  );
});

test('reportRetryGreen passes a listed flake and fails an unlisted retry-green', (t) => {
  const root = ledgerFixture(t, [row]);
  const now = new Date('2026-11-25T00:00:00Z');
  assert.equal(reportRetryGreen([row.path], { cwd: root, now }).failed, false);
  const unlisted = reportRetryGreen(
    ['apps/web/e2e/token-gate.spec.ts', 'apps/web/e2e/token-gate.spec.ts'],
    {
      cwd: root,
      now,
    },
  );
  assert.equal(unlisted.failed, false);
  assert.equal(
    reportRetryGreen(['apps/web/e2e/unlisted.spec.ts'], { cwd: root, now }).failed,
    true,
  );
});

test('playwright file id matches the runner sha1 path format', () => {
  assert.equal(playwrightFileId('token-gate.spec.ts').length, 20);
  assert.equal(playwrightFileId('dir\\spec.spec.ts'), playwrightFileId('dir/spec.spec.ts'));
  assert.notEqual(playwrightFileId('a.spec.ts'), playwrightFileId('b.spec.ts'));
});
